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
var videoInput;   // video tag element for local video stream in index.html
var videoOutput;  // video tag element for remote video stream in index.html
var directionsBox;
var statusBox;
var roleBox;
var webRtcPeer;

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
	REGISTER_RESPONSE 	: 'resgisterResponse',
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
	MSG_C2S_END			: 'MSG_C2S_END'
}

//---------------------------------------------------------------------
// Based on the registerState, disables or enables the register button
//---------------------------------------------------------------------
function setClientState(nextState) {
	switch (nextState) {
	case STATES.NOT_REGISTERED:
		$('#register').attr('disabled', false);
		$('#call').attr('disabled', true);
		$('#terminate').attr('disabled', true);
		$('#confirmVideo').attr('disabled', true);
		$('#startGame').attr('disabled', true);
		$('#play').attr('disabled', true);
		
		directionsBox.value = 
			'Please type a name into the name box and click login to continue';
		document.getElementById("describerImage").style.opacity = "0";
		document.getElementById('name').focus();
		break;
	case STATES.REGISTERING:
		$('#register').attr('disabled', true);
		directionsBox.value = 'Waiting for registration response from server'; 
		break;
	case STATES.REGISTERED:
		$('#register').attr('disabled', true);
		$('#call').attr('disabled', false);
		directionsBox.value = 
		    'Please enter a peer name and click connect'; 
		break;
	case STATES.CALLING:
		directionsBox.value = 'Attempting call'; 
		$('#call').attr('disabled', true);
		break;
	case STATES.INCOMING:
		directionsBox.value = 'Incoming call'; 
		$('#call').attr('disabled', true);
		$('#terminate').attr('disabled', true);
		$('#play').attr('disabled', true);
		break;	
	case STATES.PLAY_REQUEST:
		directionsBox.value = 'Waiting for play request response'; 
		$('#call').attr('disabled', true);
		$('#terminate').attr('disabled', true);
		$('#play').attr('disabled', true);
		break;
	case STATES.IN_CALL:
		$('#call').attr('disabled', true);
		$('#terminate').attr('disabled', false);
		$('#play').attr('disabled', true);
		$('#confirmVideo').attr('disabled', false);
		directionsBox.value = 
		    'Please click confirm when peer video begins'; 
		break;
	case STATES.WAITING_FOR_PEER_CONFIRM:
		$('#confirmVideo').attr('disabled', true);
		$('#startGame').attr('disabled', true);
		directionsBox.value = 'Click start when ready'; 
		document.getElementById("videoInput").style.opacity = "0";
		break;
	case STATES.WAITING_FOR_START:
		$('#startGame').attr('disabled', false);
		directionsBox.value = 'Click start when ready'; 
		document.getElementById("videoInput").style.opacity = "0";
		break;
	case STATES.WAITING_FOR_PEER_START:
		$('#startGame').attr('disabled', true);
		directionsBox.value = 'Waiting for your peer to click start'; 
		break;
	case STATES.REVIEWING_IMAGE:
		if(clientRole == ROLES.DESCRIBER) {
			document.getElementById("describerImage").style.opacity = "1";
			directionsBox.value = 
				'You have 30 seconds to memorize this image\'s details'; 
		}
		else {
			directionsBox.value = 
				'Describer has 30 seconds to view their image.'; 			
		}
		document.getElementById("videoOutput").style.opacity = "0";
		break;
	case STATES.FIRST_INTERROGATION:
		document.getElementById("describerImage").style.opacity = "0";
		document.getElementById("videoOutput").style.opacity = "1";
		directionsBox.value = 'You have two minutes of questioning.'; 
		break;
	case STATES.FIRST_RESPONSE:
		directionsBox.value = 
				'INTERROGATOR should now log their first decision'; 
		break;
	case STATES.SECOND_INTERROGATION:
		directionsBox.value = 'You have two more minutes of questioning.'; 
		break;
	case STATES.SECOND_RESPONSE:
		directionsBox.value = 
				'INTERROGATOR should now log their second decision'; 
		break;
	case STATES.POST_SURVEY:
		break;
		
	case STATES.POST_CALL:	 // PERHAPS WE DON'T NEED THIS?
		$('#call').attr('disabled', false);
		$('#terminate').attr('disabled', true);
		$('#play').attr('disabled', false);
		break;
	case STATES.IN_PLAYBACK:
		$('#call').attr('disabled', true);
		$('#terminate').attr('disabled', false);
		$('#play').attr('disabled', true);
		break;	
		
	default:
		return;
	}
	clientState = nextState;
	statusBox.value = clientState;
	roleBox.value = clientRole;
}

//--------------------------------------------------------------------
window.onload = function() {
	console = new Console('console', console);
	var drag = new Draggabilly(document.getElementById('videoSmall'));
	videoInput = document.getElementById('videoInput');
	videoOutput = document.getElementById('videoOutput');	
	directionsBox = document.getElementById("directionsBox");
	statusBox = document.getElementById("statusBox");
	roleBox = document.getElementById("roleBox");
    setClientState(STATES.NOT_REGISTERED);
}

//--------------------------------------------------------------------
window.onbeforeunload = function() {
	console.log("Closing websocket");
	ws.close();
}

//--------------------------------------------------------------------
// WebSocket msg handler for incoming messages from application server 
//--------------------------------------------------------------------
ws.onmessage = function(message) {
	var parsedMessage = JSON.parse(message.data);
	console.info('Received message: ' + message.data);

	switch (parsedMessage.id) {
	case MSG_S2C.REGISTER_RESPONSE:
		resgisterResponse(parsedMessage);
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
		document.getElementById('describerImage').src = parsedMessage.src;
		setClientState(STATES.REVIEWING_IMAGE);
		break;
	case MSG_S2C.START_FIRST_INT:
		setClientState(STATES.FIRST_INTERROGATION);
		break;
	case MSG_S2C.GET_FIRST_DECISION:
		setClientState(STATES.FIRST_RESPONSE);
		getDecision(true);
		break;
	case MSG_S2C.HINT:
		alert(parsedMessage.hint);
		break;
	case MSG_S2C.START_SECOND_INT:
		setClientState(STATES.SECOND_INTERROGATION);
		break;
	case MSG_S2C.GET_SECOND_DECISION:
		setClientState(STATES.SECOND_RESPONSE);
		getDecision(false);
		break;
		
	default:
		console.error('Unrecognized message', parsedMessage);
	}
}

//--------------------------------------------------------------------
function resgisterResponse(message) {
	if (message.response == 'accepted') {
		setClientState(STATES.REGISTERED);
		document.getElementById("directionsBox").value = 
	      'Please type a peer name into the Peer box and click Connect to call';
		document.getElementById('peer').focus();
	} else {
		setClientState(STATES.NOT_REGISTERED);
		var errorMessage = message.message ? message.message : 'Unknown reason for register rejection.';
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
		webRtcPeer.processSdpAnswer(message.sdpAnswer);
	}
}

//--------------------------------------------------------------------------
// Start call after receiving startCommunication msg from Application Server
// This must be subsequent to an incomingCall which was locally accepted
//--------------------------------------------------------------------------
function startCommunication(message) {
	setClientState(STATES.IN_CALL);
	// start displaying video streams
	webRtcPeer.processSdpAnswer(message.sdpAnswer);
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
		webRtcPeer.processSdpAnswer(message.sdpAnswer);
	}
}

//-----------------------------------------------------------------------
// Sends Application Server an incomingCallResponse with either a reject
// or accept based on uesr input to a confirm box
//-----------------------------------------------------------------------
function incomingCall(message) {
	// If bussy just reject without disturbing user
	if (clientState != STATES.REGISTERED && 
	    clientState != STATES.POST_CALL) {
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

		webRtcPeer = kurentoUtils.WebRtcPeer.startSendRecv(videoInput, 
		    videoOutput, 
			function(offerSdp) {
				var response = {
					id : MSG_C2S.INCOMING_CALL_RSP,
					from : message.from,
					callResponse : 'accept',
					sdpOffer : offerSdp
				};
				sendMessage(response);
			}, 
			function(error) {
				setClientState(STATES.REGISTERED);
			});
			
	} 
	else {
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
function playEnd() {
	setClientState(STATES.POST_CALL);
	hideSpinner(videoInput, videoOutput);
	document.getElementById('videoSmall').style.display = 'block';
}

//--------------------------------------------------------------------
// Handles both incoming stopCommunication msg from app server as well 
// as outgoing stop from terminate (stop) button
//--------------------------------------------------------------------
function stop(message) {
	var stopMessageId;
	if( (clientState == STATES.IN_PLAYBACK) ||
		(clientState == STATES.CALLING) ) {
		stopMessageId = MSG_C2S.STOP_PLAY;
	}
	else if(clientState == STATES.IN_CALL) {
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

		if (!message) {
			var message = {
				id : stopMessageId
			}
			sendMessage(message);
		}
	}
	hideSpinner(videoInput, videoOutput);
	document.getElementById('videoSmall').style.display = 'block';
}

//=========================================================================


//-----------------------------------------------------------------------
// Triggered by user either pressing enter in the name box or by clicking 
// register button. Sends register message to Application Server.
//-----------------------------------------------------------------------
function register() {
	var name = document.getElementById('name').value;
	if (name == '') {
		window.alert("You must insert your user name");
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
		window.alert("You must specify the peer name");
		return;
	}
	setClientState(STATES.CALLING);
	showSpinner(videoInput, videoOutput);

	webRtcPeer = kurentoUtils.WebRtcPeer.startSendRecv(videoInput, 
	    videoOutput, 
	    function(offerSdp) {
			console.log('Invoking SDP offer callback function');
			var message = {
				id : MSG_C2S.CALL,
				from : document.getElementById('name').value,
				to : document.getElementById('peer').value,
				sdpOffer : offerSdp
			};
			sendMessage(message);
		}, 
		function(error) {
			console.log(error);
			setClientState(STATES.REGISTERED);
		});
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

	webRtcPeer = kurentoUtils.WebRtcPeer.startRecvOnly(videoOutput, 
	    function(offerSdp) {
			console.log('Invoking SDP offer callback function');
			var message = {
				id : MSG_C2S.PLAY,
				user : document.getElementById('peer').value,
				sdpOffer : offerSdp
			};
			sendMessage(message);
		});
}


//--------------------------------------------------------------------
function sendMessage(message) {
	var jsonMessage = JSON.stringify(message);
	console.log('Sending message: ' + jsonMessage);
	ws.send(jsonMessage);
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
			directionsBox.value = 
				'You are an INTERROGATOR. Click start when ready to begin.'; 
			alert('You are an INTERROGATOR. Click start when ready to begin.');
		}
		else {
			clientRole = ROLES.DESCRIBER;
			directionsBox.value = 
				'You are a DESCRIBER. Click start when ready to begin.'; 
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

//--------------------------------------------------------------------
// Lightbox utility (to display media pipeline image in a modal dialog)
//--------------------------------------------------------------------
$(document).delegate('*[data-toggle="lightbox"]', 'click', function(event) {
	event.preventDefault();
	$(this).ekkoLightbox();
});
