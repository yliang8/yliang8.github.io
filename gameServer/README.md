[![][KurentoImage]][website]

kurento-one2one-call-advanced
=============================
Kurento Java Tutorial 5: WebRTC one to one video call with automatic recording and filtering.

launch on the snapdocket server with this command: 
    mvn clean compile exec:java

or:
    screen -LdmS "AdvancedCall" mvn clean compile exec:java
	
main files:
  index.html
      two video elements for remote and local video windows
	  text box for name
	  text box for peer
	  buttons to register/start/stop/play
  index.js
      ws = new WebSocket('ws://' + location.host + '/magicmirror');
      webRtcPeer = kurentoUtils.WebRtcPeer.startSendRecv // start
	  webRtcPeer.dispose()                               // stop
  	  webRtcPeer.processSdpAnswer(sdpAnswer)             // onOffer
  One2OneCallAdvApp.java
      Top level class which creates KurentoClient, UserRegistry, CallHandler, 
	  and SpringApplication.
  CallHandler.java
      protocol handler 
  UserRegistry.java
      Maintains two hashtables listing who is currently online 
	  storing the UserSession by name in one table and by id in the other.
  UserSession.java
      Storage for data associated with a user's session, includes websocket.
  CallMediaPipeline.java
      Handles creation and connection of Media Elements for one 2 one call.
  PlayMediaPipeline.java
      Handles creation and connection of Media Elements for playing the 
	  recorded video.
    
 
This is a java EE web application based on the Spring Boot framework.  It follows a client-server architecture with a Single Page Application architecture. At the client-side, the logic is implemented in JavaScript. At the server-side we use a Java application server consuming the Kurento Java Client API to control Kurento Media Server capabilities ("js/index.js") . All in all, the high level architecture of this demo is three-tier. 

To communicate these entities use websockets with a custom minimal protocol.


What is Kurento
---------------
Kurento provides an open platform for video processing and streaming
based on standards.

This platform has several APIs and components which provide solutions
to the requirements of multimedia content application developers.
These include:

  * Kurento Media Server (KMS). A full featured media server providing
    the capability to create and manage dynamic multimedia pipelines.
  * Kurento Clients. Libraries to create applications with media
    capabilities. Kurento provides libraries for Java, browser JavaScript,
    and Node.js.


Source
------
The source code of this project can be cloned from the [GitHub repository].
Code for other Kurento projects can be found in the [GitHub Kurento group].


News and Website
----------------
Information about Kurento can be found on our [website].
Follow us on Twitter @[kurentoms].


[KurentoImage]: https://secure.gravatar.com/avatar/21a2a12c56b2a91c8918d5779f1778bf?s=120
[kurentoms]: http://twitter.com/kurentoms
[LGPL License]: http://www.gnu.org/licenses/lgpl-2.1.html
[GitHub repository]: https://github.com/Kurento/kurento-tutorial-java
[GitHub Kurento group]: https://github.com/kurento
[website]: http://kurento.org
