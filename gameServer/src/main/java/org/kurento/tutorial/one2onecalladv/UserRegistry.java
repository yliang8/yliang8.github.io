package org.kurento.tutorial.one2onecalladv;

import java.util.concurrent.ConcurrentHashMap;
import org.springframework.web.socket.WebSocketSession;

//-----------------------------------------------------------------------------
// Map of users registered (online). This class has two concurrent hash maps
// to store UserSessions, one map using the UserSession name as the key, and 
// the other map using the UserSession websocket id as the key.
//-----------------------------------------------------------------------------
public class UserRegistry {

	private ConcurrentHashMap<String, UserSession> usersByName = new ConcurrentHashMap<String, UserSession>();
	private ConcurrentHashMap<String, UserSession> usersBySessionId = new ConcurrentHashMap<String, UserSession>();

	public void register(UserSession user) {
		usersByName.put(user.getName(), user);
		usersBySessionId.put(user.getSession().getId(), user);
	}

	public UserSession getByName(String name) {
		return usersByName.get(name);
	}

	public UserSession getBySession(WebSocketSession session) {
		return usersBySessionId.get(session.getId());
	}

	public boolean exists(String name) {
		return usersByName.keySet().contains(name);
	}

	public UserSession removeBySession(WebSocketSession session) {
		final UserSession user = getBySession(session);
		if (user != null) {
			usersByName.remove(user.getName());
			usersBySessionId.remove(session.getId());
		}
		return user;
	}

}
