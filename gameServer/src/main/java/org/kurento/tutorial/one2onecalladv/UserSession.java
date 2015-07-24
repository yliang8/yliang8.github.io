package org.kurento.tutorial.one2onecalladv;

import java.io.IOException;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import com.google.gson.JsonObject;

//---------------------------------------------------------------------
// Storage class for data associated with a user's session including
// WebSocketSession caller/callee names
//---------------------------------------------------------------------
public class UserSession {

	private static final Logger log = LoggerFactory
			.getLogger(UserSession.class);

	private String name; // name that the user entered in html name box
	private WebSocketSession session;

	private String sdpOffer;
	private String callingTo;    // Only callingTo or callingFrom will be 
	private String callingFrom;  // set during a call. The other will be null
	public String imageName;
	public String firstDecision;
	public String hint;
	public String secondDecision;

	
	public enum GameState {
		NOT_CONNECTED,
		WAITING_FOR_VIDEO_CONFIRM,
		WAITING_FOR_PEER_CONFIRM,
		WAITING_FOR_START,
		WAITING_FOR_PEER_START,
		REVIEWING_IMAGE,
		FIRST_INTERROGATION,
		FIRST_RESPONSE,
		SECOND_INTERROGATION,
		SECOND_RESPONSE,
		POST_SURVEY
	}
	public GameState gameState;

	public enum Role {
		NONE,
		INTERROGATOR,
		DESCRIBER
	}
	public Role role;
	
	public UserSession(WebSocketSession session, String name) {
		this.session = session;
		this.name = name;
		this.gameState = GameState.NOT_CONNECTED;
	}

	public WebSocketSession getSession() {
		return session;
	}

	public String getName() {
		return name;
	}

	public String getSdpOffer() {
		return sdpOffer;
	}

	public void setSdpOffer(String sdpOffer) {
		this.sdpOffer = sdpOffer;
	}

	public String getCallingTo() {
		return callingTo;
	}

	public void setCallingTo(String callingTo) {
		this.callingTo = callingTo;
	}

	public String getCallingFrom() {
		return callingFrom;
	}

	public void setCallingFrom(String callingFrom) {
		this.callingFrom = callingFrom;
	}

	public void sendMessage(JsonObject message) throws IOException {
		log.debug("Sending message from user '{}': {}", name, message);
		session.sendMessage(new TextMessage(message.toString()));
	}

	public String getSessionId() {
		return session.getId();
	}
}
