//-----------------------------------------------------------------------------
// client-side logic for one2one call with recording and playback.
//
// Sets up a WebSocket with the Application Server.
// Parses messages received from the server in ws.onmessage, which calls
// the appropriate handler function.
// Provides, call, play, stop, register functions which are called by html 
// elements.
// Enables/disables html buttons based on call and registration states.
//-----------------------------------------------------------------------------

var ws = new WebSocket('ws://' + location.host + '/call');
var videoInput;
var videoOutput;
var webRtcPeer;
var directionsBox;
var statusBox;
var roleBox;
var from;

// "register"ing is synonomous with being online, and does not persist between
// sessions.  Each time a user comes to the website, he will need to register. 
// A registration does not persist in a database, rather, it is removed each 
// time the client's WebSocket session is closed. This is likely to change.

var STATES = {
	NOT_REGISTERED 			: 'NOT_REGISTERED',
	REGISTERING 			: 'REGISTERING',
	REGISTERED 				: 'REGISTERED',  // NO_CALL merged in
	
	CALLING 				: 'CALLING',   // previously DISABLED
	INCOMING 				: 'INCOMING', // previously DISABLED
	IN_CALL 				: 'IN_CALL',
	
	WAITING_FOR_PEER_CONFIRM : 'WAITING_FOR_PEER_CONFIRM',	
	WAITING_FOR_START 		: 'WAITING_FOR_START',
	WAITING_FOR_PEER_START 	: 'WAITING_FOR_PEER_START',
	REVIEWING_IMAGE 		: 'REVIEWING_IMAGE',
	FIRST_INTERROGATION 	: 'FIRST_INTERROGATION',
	FIRST_RESPONSE 			: 'FIRST_RESPONSE',
	SECOND_INTERROGATION 	: 'SECOND_INTERROGATION',
	SECOND_RESPONSE			: 'SECOND_RESPONSE',
	POST_SURVEY 			: 'POST_SURVEY',
	
	POST_CALL 				: 'POST_CALL',
	PLAY_REQUEST 			: 'PLAY_REQUEST', // previously DISABLED
	IN_PLAYBACK  			: 'IN_PLAYBACK'
}

var clientState = STATES.NOT_REGISTERED;

var ROLES = {
	NONE 			: 'NONE',
	INTERROGATOR 	: 'INTERROGATOR',
	DESCRIBER 		: 'DESCRIBER'
}

var clientRole = ROLES.NONE;

// MESSAGING PROTOCOL
// id strings of Server to Client messages 
var MSG_S2C = {
	REGISTER_RESPONSE 	: 'registerResponse',
	CALL_RESPONSE		: 'callResponse',
	INCOMING_CALL		: 'incomingCall',
	START_COMMUNICATION	: 'startCommunication',
	STOP_COMMUNICATION	: 'stopCommunication',
	PLAY_RESPONSE		: 'playResponse',
	PLAY_END			: 'playEnd',
	ROLE_ASSIGNMENT		: 'roleAssignment',
	START_REVIEWING_IMG	: 'startReviewingImage',
	START_FIRST_INT		: 'startFirstInterrogation',
	GET_FIRST_DECISION	: 'getFirstDecision',
	HINT				: 'hint',
	START_SECOND_INT	: 'startSecondInterrogation',
	GET_SECOND_DECISION	: 'getSecondDecision',
	START_POST_GAME		: 'startPostGame',
	ICE_CANDIDATE		: 'iceCandidate',
	MSG_S2C_END			: 'MSG_S2C_END'
}

// id strings Client to Server messages
var MSG_C2S = {
	REGISTER			: 'register',
	CALL				: 'call',
	INCOMING_CALL_RSP	: 'incomingCallResponse',
	STOP 				: 'stop',
	STOP_PLAY			: 'stopPlay',
	PLAY 				: 'play',
	CONFIRM_VIDEO		: 'confirmVideo',
	START_GAME			: 'startGame',
	FIRST_DECISION		: 'firstDecision',
	SECOND_DECISION		: 'secondDecision',
	ON_ICE_CANDIDATE	: 'onIceCandidate',
	MSG_C2S_END			: 'MSG_C2S_END'
}

//---------------------------------------------------------------------
// Based on the registerState, disables or enables the register button
//---------------------------------------------------------------------
function setClientState(nextState) {
	switch (nextState) {
	case STATES.NOT_REGISTERED:
		directionsBox.text("Please register with your name in the control panel below");
		$("#STATES_NOT_REGISTERED").show();
		$("#name").focus();
		break;
	case STATES.REGISTERING:
		directionsBox.text("Waiting for registration response from server");
		$("#STATES_NOT_REGISTERED").show();
		$('#register').attr('disabled', true);
		break;
	case STATES.REGISTERED:
		directionsBox.text("Please enter your peer's name and call");
		$("#STATES_NOT_REGISTERED").hide();
		$("#STATES_REGISTERED").show();
		$("#peer").focus();	
		break;
	case STATES.CALLING:
		directionsBox.text("Attempting call"); 
		$("#STATES_REGISTERED").show();
		$('#call').attr('disabled', true);
		break;
	case STATES.INCOMING:
		directionsBox.text("Incoming call"); 
		$("#STATES_REGISTERED").show();
		$('#call').attr('disabled', true);
		break;	
	case STATES.IN_CALL:
		directionsBox.text("Please click confirm when peer video begins"); 
		$("#STATES_REGISTERED").hide();
		$("#STATES_IN_CALL").show();
		$("#videoOutput").show();
		break;
	case STATES.WAITING_FOR_PEER_CONFIRM:
		directionsBox.text("Waiting for your peer to confirm"); 
		$("#STATES_IN_CALL").show();
		$('#confirmVideo').attr('disabled', true);
		break;
	case STATES.WAITING_FOR_START:
		directionsBox.text("Click start when ready"); 
		$("#STATES_IN_CALL").hide();
		$("#STATES_WAITING_FOR_START").show();
		$("clientRole").text(clientRole);
		break;
	case STATES.WAITING_FOR_PEER_START:
		directionsBox.text("Waiting for your peer to click start"); 
		$("#STATES_WAITING_FOR_START").show();
		$("#startGame").attr('disabled', true);
		$("clientRole").text(clientRole);
		break;
	case STATES.REVIEWING_IMAGE:
		$("#STATES_WAITING_FOR_START").hide();
		if(clientRole == ROLES.DESCRIBER) {
			directionsBox.text("You have 30 seconds to memorize the image below");
			$("#STATES_REVIEWING_IMAGE").show();
			initCountdown(30, $('#imageCountdown'));
		}
		else {
			directionsBox.text("Describer has 30 seconds to view their image.");
			$("#STATES_REVIEWING_IMAGE").show();
			$("#describerImage").hide();
			initCountdown(30, $('#imageCountdown'));
		}
		$("clientRole").text(clientRole);
		$("#videoOutput").hide();
		$("#videoNote").text("Video is hidden for 30 seconds.");
		break;
	case STATES.FIRST_INTERROGATION:
		$("#STATES_REVIEWING_IMAGE").hide();
		$("#FIRST_INTERROGATION").show();
		$("clientRole").text(clientRole);
		initCountdown(120, $('#videoCountdown'));
		if(clientRole == ROLES.DESCRIBER) {
			directionsBox.text("You have two minutes of being questioned"); 
		}
		else {
			directionsBox.text("You have two minutes to question"); 
			$("#assignmentLine").hide();
		}
		break;
	case STATES.FIRST_RESPONSE:
		$("#FIRST_INTERROGATION").show();
		$("clientRole").text(clientRole);
		directionsBox.text("INTERROGATOR should now log their first decision now, DESCRIBER please wait. ");		
		$("#videoOutput").hide();
		$("#videoNote").text("Video is hidden as the interrogator enters his/her response");
		break;
	case STATES.SECOND_INTERROGATION:
		$("#FIRST_INTERROGATION").show();
		$("clientRole").text(clientRole);
		initCountdown(120, $('#videoCountdown'));
		if(clientRole == ROLES.DESCRIBER) {
			directionsBox.text("You have two more minutes of being questioned"); 
		}
		else {
			directionsBox.text("You have two more minutes to question"); 
			$("#assignmentLine").hide();
			$("#FIRST_INTERROGATION").append("<p><b>Hint: </b>");
		}
		break;
	case STATES.SECOND_RESPONSE:
		$("#FIRST_INTERROGATION").show();
		$("#videoOutput").hide();
		$("#videoNote").text("Video is hidden as the interrogator enters his/her response");
		$("clientRole").text(clientRole);
		directionsBox.text("INTERROGATOR should now log their second decision"); 
		break;
	case STATES.POST_CALL:
		directionsBox.text("Interrogation Ended. Your videos are recorded. Thank you very much for your participation!"); 
		$("#container2").hide();
		break;
	default:
		return;
	}
	clientState = nextState;
}


function initControlPanel() {
	$("#STATES_NOT_REGISTERED").hide();
	$("#STATES_REGISTERED").hide();
	$("#STATES_IN_CALL").hide();
	$("#STATES_WAITING_FOR_START").hide();
	$("#STATES_REVIEWING_IMAGE").hide();
	$("#FIRST_INTERROGATION").hide();
	$("#videoOutput").show();

}

//--------------------------------------------------------------------
window.onload = function() {
	console = new Console();
	var drag = new Draggabilly(document.getElementById('videoSmall'));
	videoInput = $("#videoInput");
	videoOutput = $("#videoOutput");
	directionsBox = $("#directionsBox");
	initControlPanel();

    setClientState(STATES.NOT_REGISTERED);
    setClientState(STATES.REGISTERING);
    setClientState(STATES.REGISTERED);
    setClientState(STATES.CALLING);
    setClientState(STATES.INCOMING);
    setClientState(STATES.IN_CALL);
    setClientState(STATES.WAITING_FOR_PEER_CONFIRM);
    setClientState(STATES.WAITING_FOR_START);
    setClientState(STATES.WAITING_FOR_PEER_START);
    setClientState(STATES.REVIEWING_IMAGE);
    setClientState(STATES.FIRST_INTERROGATION);
	setClientState(STATES.FIRST_RESPONSE);
    setClientState(STATES.SECOND_INTERROGATION);
    setClientState(STATES.SECOND_RESPONSE);
    // setClientState(STATES.POST_CALL);
}

//--------------------------------------------------------------------
// WebSocket msg handler for incoming messages from application server 
//--------------------------------------------------------------------
window.onbeforeunload = function() {
	console.log("Closing websocket");
	ws.close();
}

ws.onmessage = function(message) {
	var parsedMessage = JSON.parse(message.data);
	console.info('Received message: ' + message.data);

	switch (parsedMessage.id) {
	case MSG_S2C.REGISTER_RESPONSE:
		registerResponse(parsedMessage);
		break;
	case MSG_S2C.CALL_RESPONSE:
		callResponse(parsedMessage);
		break;
	case MSG_S2C.INCOMING_CALL:
		incomingCall(parsedMessage);
		break;
	case MSG_S2C.START_COMMUNICATION:
		startCommunication(parsedMessage);
		break;
	case MSG_S2C.STOP_COMMUNICATION:
		console.info("Communication ended by remote peer");
		stop(true);
		break;
	case MSG_S2C.PLAY_RESPONSE:
		playResponse(parsedMessage);
		break;
	case MSG_S2C.PLAY_END:
		playEnd();
		break;
	case MSG_S2C.ROLE_ASSIGNMENT:
	    roleAssignment(parsedMessage);
		break;
	case MSG_S2C.START_REVIEWING_IMG:
		if(clientRole == ROLES.DESCRIBER) {
			document.getElementById('describerImage').src = parsedMessage.src;
		}
		setClientState(STATES.REVIEWING_IMAGE);
		break;
	case MSG_S2C.START_FIRST_INT:
		setClientState(STATES.FIRST_INTERROGATION);
		break;
	case MSG_S2C.GET_FIRST_DECISION:
		setClientState(STATES.FIRST_RESPONSE);
		if(clientRole == ROLES.INTERROGATOR) {
			getDecision(true);
		}
		break;
	case MSG_S2C.HINT:
		alert(parsedMessage.hint);
		break;
	case MSG_S2C.START_SECOND_INT:
		setClientState(STATES.SECOND_INTERROGATION);
		break;
	case MSG_S2C.GET_SECOND_DECISION:
		setClientState(STATES.SECOND_RESPONSE);
		if(clientRole == ROLES.INTERROGATOR) {
			getDecision(false);
		}
		break;
	case MSG_S2C.ICE_CANDIDATE:
		webRtcPeer.addIceCandidate(parsedMessage.candidate, function(error) {
			if (error)
				return console.error('Error adding candidate: ' + error);
		});
		break;
	default:
		console.error('Unrecognized message', parsedMessage);
	}
}

//--------------------------------------------------------------------
function registerResponse(message) {
	if (message.response == 'accepted') {
		setClientState(STATES.REGISTERED);
		document.getElementById("directionsBox").value = 
	      'Please type a peer name into the Peer box and click Connect to call';
		document.getElementById('peer').focus();
	} else {
		setClientState(STATES.NOT_REGISTERED);
		var errorMessage = message.message ? message.message
				: 'Unknown reason for register rejection.';
		console.log(errorMessage);
		document.getElementById('name').focus();
		alert('Error registering user. See console for further information.');
	}
}

//--------------------------------------------------------------------
function callResponse(message) {
	if (message.response != 'accepted') {
		console.info('Call not accepted by peer. Closing call');
		stop();
		setClientState(STATES.REGISTERED);
		if (message.message) {
			alert(message.message);
		}
	} else {
		setClientState(STATES.IN_CALL);
		// start displaying video streams
		webRtcPeer.processAnswer(message.sdpAnswer, function(error) {
			if (error)
				return console.error(error);
		});
	}
}

//--------------------------------------------------------------------------
// Start call after receiving startCommunication msg from Application Server
// This must be subsequent to an incomingCall which was locally accepted
//--------------------------------------------------------------------------
function startCommunication(message) {
	setClientState(STATES.IN_CALL);
	// start displaying video streams
	webRtcPeer.processAnswer(message.sdpAnswer, function(error) {
		if (error)
			return console.error(error);
	});
}

//--------------------------------------------------------------------
function playResponse(message) {
	if (message.response != 'accepted') {
		hideSpinner(videoOutput);
		document.getElementById('videoSmall').style.display = 'block';
		alert(message.error);
		document.getElementById('peer').focus();
		setClientState(STATES.POST_CALL); // why not REGISTERED?
	} else {
		setClientState(STATES.IN_PLAYBACK);
	    // start displaying video streams
		webRtcPeer.processAnswer(message.sdpAnswer, function(error) {
			if (error)
				return console.error(error);
		});
	}
}

//-----------------------------------------------------------------------
// Sends Application Server an incomingCallResponse with either a reject
// or accept based on user input to a confirm box
//-----------------------------------------------------------------------
function incomingCall(message) {
	// If bussy just reject without disturbing user
	if (clientState != STATES.REGISTERED && 
	    clientState != STATES.POST_CALL)  {
		var response = {
			id : MSG_C2S.INCOMING_CALL_RSP,
			from : message.from,
			callResponse : 'reject',
			message : 'bussy'
		};
		return sendMessage(response);
	}

	setClientState(STATES.INCOMING);
	if (confirm('User ' + message.from
			+ ' is calling you. Do you accept the call?')) {
		showSpinner(videoInput, videoOutput);

		from = message.from;
		var options = {
			localVideo : videoInput,
			remoteVideo : videoOutput,
			onicecandidate : onIceCandidate
		}
		webRtcPeer = new kurentoUtils.WebRtcPeer.WebRtcPeerSendrecv(options,
				function(error) {
					if (error) {
						return console.error(error);
					}
					this.generateOffer(onOfferIncomingCall);
				});
	} else {
		var response = {
			id : MSG_C2S.INCOMING_CALL_RSP,
			from : message.from,
			callResponse : 'reject',
			message : 'user declined'
		};
		sendMessage(response);
		stop();
	}
}

//--------------------------------------------------------------------
function onOfferIncomingCall(error, offerSdp) {
	if (error)
		return console.error('Error generating the offer ' + error);
	var response = {
		id : MSG_C2S.INCOMING_CALL_RSP,
		from : from,
		callResponse : 'accept',
		sdpOffer : offerSdp
	};
	sendMessage(response);
}

//-----------------------------------------------------------------------
// Triggered by user either pressing enter in the name box or by clicking 
// register button. Sends register message to Application Server.
//-----------------------------------------------------------------------
function register() {
	var name = document.getElementById('name').value;
	if (name == '') {
		$("#noUserNameAlert").text("You must enter your username");
		document.getElementById('name').focus();
		return;
	}
	setClientState(STATES.REGISTERING);

	var message = {
		id : MSG_C2S.REGISTER,
		name : name
	};
	sendMessage(message);
}

//----------------------------------------------------------------------------
// Triggered by user clicking on call button. Invokes WebRtcPeer.startSendRecv
// and sends call message to Application Server.
//--------------------------------------------------------------------
function call() {
	if (document.getElementById('peer').value == '') {
		document.getElementById('peer').focus();
		$("#noPeerNameAlert").text("You must specify a peer name");
		return;
	}
	setClientState(STATES.CALLING);
	showSpinner(videoInput, videoOutput);

	var options = {
		localVideo : videoInput,
		remoteVideo : videoOutput,
		onicecandidate : onIceCandidate
	}
	webRtcPeer = new kurentoUtils.WebRtcPeer.WebRtcPeerSendrecv(options,
			function(error) {
				if (error) {
					return console.error(error);
				}
				this.generateOffer(onOfferCall);
			});
}

//--------------------------------------------------------------------
function onOfferCall(error, offerSdp) {
	if (error)
		return console.error('Error generating the offer ' + error);
	console.log('Invoking SDP offer callback function');
	var message = {
		id : MSG_C2S.CALL,
		from : document.getElementById('name').value,
		to : document.getElementById('peer').value,
		sdpOffer : offerSdp
	};
	sendMessage(message);
}

//--------------------------------------------------------------------
function play() {
	var peer = document.getElementById('peer').value;
	if (peer == '') {
		window.alert("You must insert the name of the user recording to be played (field 'Peer')");
		document.getElementById('peer').focus();
		return;
	}

	document.getElementById('videoSmall').style.display = 'none';
	setClientState(STATES.PLAY_REQUEST);
	showSpinner(videoOutput);

	var options = {
		remoteVideo : videoOutput,
		onicecandidate : onIceCandidate
	}
	webRtcPeer = new kurentoUtils.WebRtcPeer.WebRtcPeerRecvonly(options,
			function(error) {
				if (error) {
					return console.error(error);
				}
				this.generateOffer(onOfferPlay);
			});
}

//--------------------------------------------------------------------
function onOfferPlay(error, offerSdp) {
	console.log('Invoking SDP offer callback function');
	var message = {
		id : MSG_C2S.PLAY,
		user : document.getElementById('peer').value,
		sdpOffer : offerSdp
	};
	sendMessage(message);
}

//--------------------------------------------------------------------
function playEnd() {
	setClientState(STATES.POST_CALL);
	hideSpinner(videoInput, videoOutput);
	document.getElementById('videoSmall').style.display = 'block';
}

//--------------------------------------------------------------------
// Handles both incoming stopCommunication msg from app server as well 
// as outgoing stop from terminate (stop) button, 
// Also called when incoming unaccepted callResponse, or when incomingCall
// that user rejects.
// ---------
// fromServer arg is a boolean
//--------------------------------------------------------------------
function stop(fromServer) {
	var stopMessageId;
	if( (clientState == STATES.IN_PLAYBACK) ||
		(clientState == STATES.CALLING) ) {
		stopMessageId = MSG_C2S.STOP_PLAY;
	}
	else if(clientState == STATES.IN_CALL) {
		stopMessageId = MSG_C2S.STOP;
	}
	else if(clientState == STATES.SECOND_RESPONSE) {
		alert("Thank you for playing! Goodbye!.");
		stopMessageId = MSG_C2S.STOP;
	}
	else {
		alert("ERROR: Unexpected STOP.");
		stopMessageId = MSG_C2S.STOP;
	}
	setClientState(STATES.POST_CALL);
	if (webRtcPeer) {
		webRtcPeer.dispose();
		webRtcPeer = null;

		// if the stop was not invoked by server, send the peer a stop
		if (!fromServer) {
			var message = {
				id : stopMessageId
			}
			sendMessage(message);
		}
	}
	hideSpinner(videoInput, videoOutput);
	document.getElementById('videoSmall').style.display = 'block';
}

//--------------------------------------------------------------------
function sendMessage(message) {
	var jsonMessage = JSON.stringify(message);
	console.log('Senging message: ' + jsonMessage);
	ws.send(jsonMessage);
}

//--------------------------------------------------------------------
function onIceCandidate(candidate) {
	console.log('Local candidate ' + JSON.stringify(candidate));

	var message = {
		id : MSG_C2S.ON_ICE_CANDIDATE,
		candidate : candidate
	};
	sendMessage(message);
}

//--------------------------------------------------------------------
function showSpinner() {
	for (var i = 0; i < arguments.length; i++) {
		arguments[i].poster = './img/transparent-1px.png';
		arguments[i].style.background = 'center transparent url("./img/spinner.gif") no-repeat';
	}
}

//--------------------------------------------------------------------
function hideSpinner() {
	for (var i = 0; i < arguments.length; i++) {
		arguments[i].src = '';
		arguments[i].poster = './img/webrtc.png';
		arguments[i].style.background = '';
	}
}


//--------------------------------------------------------------------
function roleAssignment(message) {
	if(clientState != STATES.WAITING_FOR_PEER_CONFIRM) {
		console.log('ERROR: roleAssignment received in wrong state');
	}
	else {
		if(message.role == 'interrogator') {
			clientRole = ROLES.INTERROGATOR;
			alert('You are an INTERROGATOR. Click start when ready to begin.');
		}
		else {
			clientRole = ROLES.DESCRIBER;
			alert('You are a DESCRIBER. Click start when ready to begin.');
		}
		setClientState(STATES.WAITING_FOR_START); // to update display
	}
}

//-----------------------------------------------------------------------
// Triggered by user either pressing enter in the name box or by clicking 
// register button. Sends register message to Application Server.
//-----------------------------------------------------------------------
function confirmVideo() {
	
	// Add code to disable start button. Perhaps a game state variable.
	
	var message = {
		id : MSG_C2S.CONFIRM_VIDEO,
	};
	sendMessage(message);
	setClientState(STATES.WAITING_FOR_PEER_CONFIRM);
}

//-----------------------------------------------------------------------
// Triggered by user either pressing enter in the name box or by clicking 
// register button. Sends register message to Application Server.
//-----------------------------------------------------------------------
function startGameSend() {
	
	// Add code to disable start button. Perhaps a game state variable.
	
	var message = {
		id : MSG_C2S.START_GAME,
	};
	sendMessage(message);
	setClientState(STATES.WAITING_FOR_PEER_START);
}

//-----------------------------------------------------------------------
// Queries user and sends response back to Application Server
//-----------------------------------------------------------------------
function getDecision(firstDecision) {
	var response;
	var idString;
	
	if(firstDecision) {
		idString = MSG_C2S.FIRST_DECISION;
	}
	else {
		idString = MSG_C2S.SECOND_DECISION;
	}
	if (confirm('Click OK if you think DESCRIBER is being honest, click cancel if you think he/she is bluffing. ')) {
		response = {
			id : idString,
			decision : 'truth',
		};
	} 
	else {
		response = {
			id : idString,
			decision : 'bluff',
		};
	}
	sendMessage(response);
}


//--------------------------------------------------------------------------
// Function for countdown timer
//--------------------------------------------------------------------------
function initCountdown(initTime, jqueryDOMElement) {
	var timer;
	var time = initTime;
	jqueryDOMElement.text(time);
	timer = setInterval(function() {
		time--;
		if (time < 0) {
			alert('Time Out!');
			clearInterval(timer);
			return;
		}
		jqueryDOMElement.text(time);
	}, 1000);
}


//--------------------------------------------------------------------------
// Lightbox utility (to display media pipeline image in a modal dialog)
//--------------------------------------------------------------------------
$(document).delegate('*[data-toggle="lightbox"]', 'click', function(event) {
	event.preventDefault();
	$(this).ekkoLightbox();
});
