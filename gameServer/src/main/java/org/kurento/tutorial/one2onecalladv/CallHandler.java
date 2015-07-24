package org.kurento.tutorial.one2onecalladv;

import java.io.IOException;
import java.util.concurrent.ConcurrentHashMap;

import org.kurento.client.MediaPipeline;
import org.kurento.client.KurentoClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;

//---------------------------------------------------------------------------
// Protocol handler for 1 to 1 video call communication and game progression.
//---------------------------------------------------------------------------
public class CallHandler extends TextWebSocketHandler {

	private static final Logger log = LoggerFactory
			.getLogger(CallHandler.class);
	private static final Gson gson = new GsonBuilder().create();

	private ConcurrentHashMap<String, MediaPipeline> pipelines = new ConcurrentHashMap<String, MediaPipeline>();

	@Autowired
	private KurentoClient kurento;

	@Autowired
	private UserRegistry registry;

	public static final int REVIEWING_SEC = 30;
	public static final int FIRST_INT_SEC = 60;
	public static final int SECOND_INT_SEC = 60;
	
	// MESSAGING PROTOCOL
	// id strings of Server to Client messages
	public class MSG_S2C 
	{
		final static String REGISTER_RESPONSE 	= "resgisterResponse";
		final static String CALL_RESPONSE		= "callResponse";
		final static String INCOMING_CALL		= "incomingCall";
		final static String START_COMMUNICATION	= "startCommunication";
		final static String STOP_COMMUNICATION	= "stopCommunication";
		final static String PLAY_RESPONSE		= "playResponse";
		final static String PLAY_END			= "playEnd";
		final static String ROLE_ASSIGNMENT		= "roleAssignment";
		final static String START_REVIEWING_IMG	= "startReviewingImage";
		final static String START_FIRST_INT		= "startFirstInterrogation";
		final static String GET_FIRST_DECISION	= "getFirstDecision";
		final static String HINT				= "hint";
		final static String START_SECOND_INT	= "startSecondInterrogation";
		final static String GET_SECOND_DECISION	= "getSecondDecision";
		final static String START_POST_GAME		= "startPostGame";
	}

	public class MSG_C2S 
	{
		final static String REGISTER 			= "register";
		final static String CALL				= "call";
		final static String INCOMING_CALL_RSP	= "incomingCallResponse";
		final static String STOP 				= "stop";
		final static String STOP_PLAY			= "stopPlay";
		final static String PLAY 				= "play";
		final static String CONFIRM_VIDEO		= "confirmVideo";
		final static String START_GAME			= "startGame";
		final static String FIRST_DECISION		= "firstDecision";
		final static String SECOND_DECISION		= "secondDecision";
	}

	@Override
	//-------------------------------------------------------------------------
	// Calls appropriate methods based on protocol messages recvd from clients.
	//    register, call, incomingCallResponse, play, stop, stopPlay
	//-------------------------------------------------------------------------
	public void handleTextMessage(WebSocketSession session, TextMessage message)
			throws Exception {
		JsonObject jsonMessage = gson.fromJson(message.getPayload(),
				JsonObject.class);
		UserSession user = registry.getBySession(session);

		if (user != null) {
			log.debug("Incoming message from user '{}': {}", user.getName(),
					jsonMessage);
		} else {
			log.debug("Incoming message from new user: {}", jsonMessage);
		}

		switch (jsonMessage.get("id").getAsString()) {
		case MSG_C2S.REGISTER:
			register(session, jsonMessage);
			break;
		case MSG_C2S.CALL:
			call(user, jsonMessage);
			break;
		case MSG_C2S.INCOMING_CALL_RSP:
			incomingCallResponse(user, jsonMessage);
			break;
		case MSG_C2S.PLAY:
			play(session, jsonMessage);
			break;
		case MSG_C2S.STOP:
			stopCommunication(session);
			releasePipeline(session);
			break;
		case MSG_C2S.STOP_PLAY:
			releasePipeline(session);
			break;
		case MSG_C2S.CONFIRM_VIDEO:
			confirmVideo(user);
			break;
		case MSG_C2S.START_GAME:
			startGame(user);
			break;
		case MSG_C2S.FIRST_DECISION:
			startSecondInterrogation(user, jsonMessage);
			break;
		default:
			break;
		}
	}

	//--------------------------------------------------------------------------
	// In response to client "register" message,
	// Adds provided name to registry if it does not already exist. Sends 
	// response of whether add was successful back to client ("registerResponse")
	//--------------------------------------------------------------------------
	private void register(WebSocketSession session, JsonObject jsonMessage)
			throws IOException {
		String name = jsonMessage.getAsJsonPrimitive("name").getAsString();

		UserSession caller = new UserSession(session, name);
		String responseMsg = "accepted";
		if (name.isEmpty()) {
			responseMsg = "rejected: empty user name";
		} else if (registry.exists(name)) {
			responseMsg = "rejected: user '" + name + "' already registered";
		} else {
			registry.register(caller);
		}

		JsonObject response = new JsonObject();
		response.addProperty("id", "resgisterResponse");
		response.addProperty("response", responseMsg);
		caller.sendMessage(response);
	}

	//--------------------------------------------------------------------------
    // In response to client "call" message:
	//   checks that callee ("to") exists in registry, and if so, sends an 
	//   "incomingCall" message to the callee client
	//--------------------------------------------------------------------------
	private void call(UserSession caller, JsonObject jsonMessage)
			throws IOException {
		String to = jsonMessage.get("to").getAsString();
		String from = jsonMessage.get("from").getAsString();
		JsonObject response = new JsonObject();

		if (registry.exists(to)) {
			UserSession callee = registry.getByName(to);
			caller.setSdpOffer(jsonMessage.getAsJsonPrimitive("sdpOffer")
					.getAsString());
			caller.setCallingTo(to);

			response.addProperty("id", MSG_S2C.INCOMING_CALL);
			response.addProperty("from", from);

			callee.sendMessage(response);
			callee.setCallingFrom(from);
		} else {
			response.addProperty("id", MSG_S2C.CALL_RESPONSE);
			response.addProperty("response", "rejected");
			response.addProperty("message", "user '" + to
					+ "' is not registered");

			caller.sendMessage(response);
		}
	}

	//--------------------------------------------------------------------------
	//--------------------------------------------------------------------------
	private void incomingCallResponse(UserSession callee, JsonObject jsonMessage)
			throws IOException {
		String callResponse = jsonMessage.get("callResponse").getAsString();
		String from = jsonMessage.get("from").getAsString();
		UserSession calleer = registry.getByName(from);
		String to = calleer.getCallingTo();

		if ("accept".equals(callResponse)) {
			log.debug("Accepted call from '{}' to '{}'", from, to);

			CallMediaPipeline callMediaPipeline = new CallMediaPipeline(
					kurento, from, to);
			pipelines.put(calleer.getSessionId(),
					callMediaPipeline.getPipeline());
			pipelines.put(callee.getSessionId(),
					callMediaPipeline.getPipeline());

			String calleeSdpOffer = jsonMessage.get("sdpOffer").getAsString();
			String calleeSdpAnswer = callMediaPipeline
					.generateSdpAnswerForCallee(calleeSdpOffer);

			JsonObject startCommunication = new JsonObject();
			startCommunication.addProperty("id", MSG_S2C.START_COMMUNICATION);
			startCommunication.addProperty("sdpAnswer", calleeSdpAnswer);
			callee.sendMessage(startCommunication);

			String callerSdpOffer = registry.getByName(from).getSdpOffer();
			String callerSdpAnswer = callMediaPipeline
					.generateSdpAnswerForCaller(callerSdpOffer);

			JsonObject response = new JsonObject();
			response.addProperty("id", MSG_S2C.CALL_RESPONSE);
			response.addProperty("response", "accepted");
			response.addProperty("sdpAnswer", callerSdpAnswer);
			calleer.sendMessage(response);

			callMediaPipeline.record();
			
			// set gameState
			callee.gameState = UserSession.GameState.WAITING_FOR_VIDEO_CONFIRM;
			calleer.gameState = UserSession.GameState.WAITING_FOR_VIDEO_CONFIRM;
			
			/*
			// after 30 seconds send the hideDescriberImage message
			try {
				Thread.sleep(30000);                 //1000 milliseconds is one second.
			} catch(InterruptedException ex) {
				Thread.currentThread().interrupt();
			}
			JsonObject hideDescriberImage = new JsonObject();
			hideDescriberImage.addProperty("id", "hideDescriberImage");
			//hideDescriberImage.addProperty("sdpAnswer", calleeSdpAnswer);
			callee.sendMessage(hideDescriberImage);
			*/

		} else {
			JsonObject response = new JsonObject();
			response.addProperty("id", MSG_S2C.CALL_RESPONSE);
			response.addProperty("response", "rejected");
			calleer.sendMessage(response);
		}
	}

	//--------------------------------------------------------------------------
	public void stopCommunication(WebSocketSession session) throws IOException {
		// Both users can stop the communication. A 'stopCommunication'
		// message will be sent to the other peer.
		UserSession stopperUser = registry.getBySession(session);
		UserSession stoppedUser = (stopperUser.getCallingFrom() != null) ? registry
				.getByName(stopperUser.getCallingFrom()) : registry
				.getByName(stopperUser.getCallingTo());

		JsonObject message = new JsonObject();
		message.addProperty("id", "stopCommunication");
		stoppedUser.sendMessage(message);
	}

	//--------------------------------------------------------------------------
	public void releasePipeline(WebSocketSession session) throws IOException {
		String sessionId = session.getId();
		if (pipelines.containsKey(sessionId)) {
			pipelines.get(sessionId).release();
			pipelines.remove(sessionId);
		}
	}

	private void play(WebSocketSession session, JsonObject jsonMessage)
			throws IOException {
		String user = jsonMessage.get("user").getAsString();
		log.debug("Playing recorded call of user '{}'", user);

		JsonObject response = new JsonObject();
		response.addProperty("id", MSG_S2C.PLAY_RESPONSE);

		if (registry.getByName(user) != null
				&& registry.getBySession(session) != null) {
			PlayMediaPipeline playMediaPipeline = new PlayMediaPipeline(
					kurento, user, session);
			String sdpOffer = jsonMessage.get("sdpOffer").getAsString();
			String sdpAnswer = playMediaPipeline.generateSdpAnswer(sdpOffer);

			response.addProperty("response", "accepted");
			response.addProperty("sdpAnswer", sdpAnswer);

			playMediaPipeline.play();

			pipelines.put(session.getId(), playMediaPipeline.getPipeline());
		} else {
			response.addProperty("response", "rejected");
			response.addProperty("error", "No recording for user '" + user
					+ "'. Please type a correct user in the 'Peer' field.");
		}
		session.sendMessage(new TextMessage(response.toString()));
	}

	//--------------------------------------------------------------------------
	// Handle 'confirmVideo' message from client.  Checks that the user is
	// in a call, changes users gameState to 
	//--------------------------------------------------------------------------
	private void confirmVideo(UserSession user)
			throws IOException {
		log.debug("Received video confirmation from user '{}'", user.getName());
		log.debug("user.getCallingTo()= '{}'", user.getCallingTo());
		log.debug("user.getCallingFrom()= '{}'", user.getCallingFrom());
		UserSession otherUser = null;
			
		if(user.gameState == UserSession.GameState.WAITING_FOR_VIDEO_CONFIRM) {
			user.gameState = UserSession.GameState.WAITING_FOR_PEER_CONFIRM;
		}
		if(user.gameState == UserSession.GameState.WAITING_FOR_PEER_CONFIRM) {
			if(user.getCallingTo() == null) {
				otherUser = registry.getByName(user.getCallingFrom());
			}
			else {
				otherUser = registry.getByName(user.getCallingTo());
			}			
			
			if(otherUser == null) {
				log.debug("ERROR: confirmVideo with null otherUser. from user '{}'",user.getName());
				return;
			}				
			assignRoles(user, otherUser);
		}
		else {
			// Unexpected confirm received.
			log.debug("ERROR: Unexpected confirm from user '{}'", 
					  user.getName());
		}
		
	}
	
	//-------------------------------------------------------------------------
	private void assignRoles(UserSession a, UserSession b) 
			throws IOException {
				
		UserSession first = null;
		UserSession second = null;
		log.debug("assignRoles()");
		if( (a == null ) || (b == null) ) {
			log.debug("ERROR: assignRoles(-) called with null user");
			return;
		}
		if( a.getName().compareTo(b.getName()) > 0 ) {
			first = a;
			second = b;
		}
		else {
			first = b;
			second = a;
		}
		synchronized(first) {
			synchronized(second) {
				if( (first.gameState == 
				        UserSession.GameState.WAITING_FOR_PEER_CONFIRM) &&
				    (second.gameState == 
					    UserSession.GameState.WAITING_FOR_PEER_CONFIRM) ) {
							
					first.gameState = UserSession.GameState.WAITING_FOR_START;
					second.gameState = UserSession.GameState.WAITING_FOR_START;
					
					// SET ROLES and SEND MESSAGE
					// TODO: add randomness
					first.role = UserSession.Role.INTERROGATOR;
					JsonObject message = new JsonObject();
					message.addProperty("id", MSG_S2C.ROLE_ASSIGNMENT);
					message.addProperty("role", "interrogator");
					first.sendMessage(message);

					second.role = UserSession.Role.DESCRIBER;
					message = new JsonObject(); // is sendMessage destructive?
					message.addProperty("id", MSG_S2C.ROLE_ASSIGNMENT);
					message.addProperty("role", "describer");
					second.sendMessage(message);
				}
			}
		}
	}

	//-------------------------------------------------------------------------
	private void startGame(UserSession user)
			throws IOException {
		log.debug("Received startGame from user '{}'", user.getName());
		log.debug("user.getCallingTo()= '{}'", user.getCallingTo());
		log.debug("user.getCallingFrom()= '{}'", user.getCallingFrom());
		UserSession otherUser = null;
		
		if(user.gameState == UserSession.GameState.WAITING_FOR_START) {
			user.gameState = UserSession.GameState.WAITING_FOR_PEER_START;
		}
		
		if(user.gameState == UserSession.GameState.WAITING_FOR_PEER_START) {		
			if(user.getCallingTo() == null) {
				otherUser = registry.getByName(user.getCallingFrom());
			}
			else {
				otherUser = registry.getByName(user.getCallingTo());
			}			
			if(otherUser == null) {
				log.debug("ERROR: StartGame called with no other user detected. from user '{}'", user.getName());
				return;
			}				
			synchronizeStart(user, otherUser);
		}
	}

	//-------------------------------------------------------------------------
	private void synchronizeStart(UserSession a, UserSession b) 
			throws IOException {
		UserSession first = null;
		UserSession second = null;
	
		if( (a == null ) || (b == null) ) {
			log.debug("ERROR: synchronizeStart(-) called with null user");
			return;
		}
		if( a.getName().compareTo(b.getName()) > 0 ) {
			first = a;
			second = b;
		}
		else {
			first = b;
			second = a;
		}
		synchronized(first) {
			synchronized(second) {
				if( (first.gameState == 
				        UserSession.GameState.WAITING_FOR_PEER_START) &&
				    (second.gameState == 
					    UserSession.GameState.WAITING_FOR_PEER_START) ) {
							
					first.gameState = UserSession.GameState.REVIEWING_IMAGE;
					second.gameState = UserSession.GameState.REVIEWING_IMAGE;
					
					// Pick image; TODO: make random
					a.imageName = b.imageName = "./img/Hat.png";
					a.hint = b.hint = "article of clothing";
					
					// SEND MESSAGES
					JsonObject message = new JsonObject();
					message.addProperty("id", MSG_S2C.START_REVIEWING_IMG);
					
					if(first.role == UserSession.Role.INTERROGATOR) {
						first.sendMessage(message);
					}
					else {
						second.sendMessage(message);
					}
					// add the image src property to the describer's message
					message.addProperty("src", first.imageName);
					if(first.role == UserSession.Role.DESCRIBER) {
						first.sendMessage(message);
					}
					else {
						second.sendMessage(message);
					}
					
					// replace this sleep with a timer spawn
					// after 30 seconds send the message
					try {
						Thread.sleep(REVIEWING_SEC * 1000);                 //1000 milliseconds is one second.
					} catch(InterruptedException ex) {
						Thread.currentThread().interrupt();
					}
				}
			}
		}
		startInterrogation(a, b);
	}
	//-------------------------------------------------------------------------
	private void startInterrogation(UserSession a, UserSession b) 
			throws IOException {
		UserSession first = null;
		UserSession second = null;
	
		if( (a == null ) || (b == null) ) {
			log.debug("ERROR: startInterrogation(-) called with null user");
			return;
		}
		if( a.getName().compareTo(b.getName()) > 0 ) {
			first = a;
			second = b;
		}
		else {
			first = b;
			second = a;
		}
		synchronized(first) {
			synchronized(second) {
				if( (first.gameState == 
				        UserSession.GameState.REVIEWING_IMAGE) &&
				    (second.gameState == 
					    UserSession.GameState.REVIEWING_IMAGE) ) {
							
					first.gameState = UserSession.GameState.FIRST_INTERROGATION;
					second.gameState = UserSession.GameState.FIRST_INTERROGATION;
					
					// SEND MESSAGE
					JsonObject message = new JsonObject();
					message.addProperty("id", MSG_S2C.START_FIRST_INT);
					first.sendMessage(message);
					second.sendMessage(message); 
					
					// replace this sleep with a timer spawn
					// after 2 min send the message
					try {
						Thread.sleep(FIRST_INT_SEC*1000);               //1000 milliseconds is one second.
					} catch(InterruptedException ex) {
						Thread.currentThread().interrupt();
					}
					message = new JsonObject();
					message.addProperty("id", MSG_S2C.GET_FIRST_DECISION);
					if(first.role == UserSession.Role.INTERROGATOR) {
						first.sendMessage(message);
					}
					else {
						second.sendMessage(message);
					}
					first.gameState = UserSession.GameState.FIRST_RESPONSE;
					second.gameState = UserSession.GameState.FIRST_RESPONSE;

				}
				else {
					log.debug("ERROR: interrogationStart(-) called out of sync");
				}
			}
		}
	}

		//-------------------------------------------------------------------------
	private void startSecondInterrogation(UserSession interrogator, 
										  JsonObject jsonMessage) 
			throws IOException {
		UserSession describer = null;
		UserSession first = null;
		UserSession second = null;
	
	
		if(interrogator.getCallingTo() == null) {
			describer = registry.getByName(interrogator.getCallingFrom());
		}
		else {
			describer = registry.getByName(interrogator.getCallingTo());
		}			
		if(describer == null) {
			log.debug("ERROR: startSecondInterrogation called with no other user detected. from user '{}'", interrogator.getName());
			return;
		}				

		// Save decision to file
		// TODO:
		// maybe better to save until game end, and write image, hint, decisions
		// all at once?
		// 
		interrogator.firstDecision = jsonMessage.get("decision").getAsString();
		describer.firstDecision = interrogator.firstDecision;
		
		if( interrogator.getName().compareTo(describer.getName()) > 0 ) {
			first = interrogator;
			second = describer;
		}
		else {
			first = describer;
			second = interrogator;
		}		
		synchronized(first) {
			synchronized(second) {
				if( (first.gameState == 
				        UserSession.GameState.FIRST_RESPONSE) &&
				    (second.gameState == 
					    UserSession.GameState.FIRST_RESPONSE) ) {
							
					first.gameState = UserSession.GameState.SECOND_INTERROGATION;
					second.gameState = UserSession.GameState.SECOND_INTERROGATION;
					
					// SEND HINT MESSAGE
					JsonObject message = new JsonObject();
					message.addProperty("id", MSG_S2C.HINT);
					message.addProperty("hint", first.hint);
					interrogator.sendMessage(message);
					
					// SEND SECOND INT MESSAGE
					message = new JsonObject();
					message.addProperty("id", MSG_S2C.START_SECOND_INT);
					first.sendMessage(message);
					second.sendMessage(message); 
					
					// replace this sleep with a timer spawn
					// after 2 min send the message
					try {
						Thread.sleep(SECOND_INT_SEC*1000);                 //1000 milliseconds is one second.
					} catch(InterruptedException ex) {
						Thread.currentThread().interrupt();
					}
					// SEND SECOND DECISION MESSAGE
					message = new JsonObject();
					message.addProperty("id", MSG_S2C.GET_SECOND_DECISION);
					interrogator.sendMessage(message);
					
					first.gameState = UserSession.GameState.SECOND_RESPONSE;
					second.gameState = UserSession.GameState.SECOND_RESPONSE;
				}
				else {
					log.debug("ERROR: interrogationStart(-) called out of sync");
				}
			}
		}
	}
	
	//-------------------------------------------------------------------------
	@Override
	public void afterConnectionClosed(WebSocketSession session,
			CloseStatus status) throws Exception {
		registry.removeBySession(session);
	}

}
