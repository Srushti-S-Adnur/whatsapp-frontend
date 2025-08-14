

import React, { useEffect, useState } from "react";
import { io } from "socket.io-client";
import axios from "axios";
import { BsCheck, BsCheckAll } from "react-icons/bs";
import Login from "./login";
import Register from "./pages/Register";

export default function App() {
  // ---- Auth ----
  const [user, setUser] = useState(null);
  const [showRegister, setShowRegister] = useState(false);

  // ---- Chat state ----
  const [conversations, setConversations] = useState([]);
  const [messages, setMessages] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [userInfo, setUserInfo] = useState(null);

  // ---- UI state ----
  const [newMessage, setNewMessage] = useState("");
  const [file, setFile] = useState(null);
  const [convSearch, setConvSearch] = useState("");
  const [messageSearch, setMessageSearch] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [typingUser, setTypingUser] = useState(null);
  const [userStatuses, setUserStatuses] = useState({});

  // ---- API & Socket ----
  const API_URL = "https://whatsapp-backend-mf5s.onrender.com";
  const [socket, setSocket] = useState(null);

  // ---- Auth: restore session & axios headers ----
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;

    axios
      .get(`${API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => {
        setUser(res.data);
        axios.defaults.headers.common["Authorization"] = `Bearer ${token}`;

        // Connect socket after auth
        const newSocket = io(API_URL, {
          auth: { token },
          transports: ["websocket"],
        });
        setSocket(newSocket);
      })
      .catch(() => {
        setUser(null);
        delete axios.defaults.headers.common["Authorization"];
        localStorage.removeItem("token");
      });
  }, []);

  // ---- Request Notification permission ----
  useEffect(() => {
    if (Notification.permission !== "granted") {
      Notification.requestPermission();
    }
  }, []);

  // ---- Emit online status on login ----
  useEffect(() => {
    if (socket && user) {
      socket.emit("userOnline", user._id);
    }
  }, [socket, user]);

  // ---- Fetch conversations ----
  useEffect(() => {
    if (!user) return;

    axios
      .get(`${API_URL}/api/messages`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      })
      .then((res) => {
        const list = res.data || [];
        const listWithUnread = list.map((conv) => ({
          ...conv,
          unreadCount: conv.messages?.filter((m) => m.unread).length || 0,
        }));
        if (!convSearch.trim()) {
          setConversations(listWithUnread);
        } else {
          const q = convSearch.toLowerCase();
          setConversations(
            listWithUnread.filter(
              (c) =>
                c._id?.toLowerCase().includes(q) ||
                (c.name && c.name.toLowerCase().includes(q))
            )
          );
        }
      })
      .catch((err) => console.error(err));
  }, [convSearch, messages, user]);

  // ---- Fetch messages for selected conversation ----
  useEffect(() => {
    if (!selectedUser) return;

    const token = localStorage.getItem("token");
    const endpoint = selectedUser.isGroup
      ? `${API_URL}/api/messages/group/${selectedUser._id}`
      : `${API_URL}/api/messages/${selectedUser._id}`;

    axios
      .get(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => setMessages(res.data || []))
      .catch((err) => console.error(err));

    if (!selectedUser.isGroup) {
      axios.post(
        `${API_URL}/api/messages/markRead/${selectedUser._id}`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
    }
  }, [selectedUser]);

  // ---- Fetch user info ----
  useEffect(() => {
    if (!selectedUser || selectedUser.isGroup) return;
    const token = localStorage.getItem("token");
    axios
      .get(`${API_URL}/api/messages/user/${selectedUser}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => setUserInfo(res.data))
      .catch(() => setUserInfo(null));
  }, [selectedUser]);

  // ---- Socket listeners ----
  useEffect(() => {
    if (!socket || !user) return;

    socket.on("newMessage", (message) => {
      if (message?.wa_id === selectedUser?._id) {
        setMessages((prev) => {
          if (message._id && prev.some((m) => m._id === message._id)) return prev;
          return [...prev, message];
        });
      }
      if (message.from !== user?.name && Notification.permission === "granted") {
        new Notification("New message", {
          body: message.text || "Media received",
          icon: "/whatsapp-icon.png",
        });
      }
    });

    socket.on("typing", (data) => {
      if (data.to === user?._id) {
        setTypingUser(data.from);
        setIsTyping(true);
      }
    });

    socket.on("stopTyping", (data) => {
      if (data.to === user?._id) {
        setIsTyping(false);
      }
    });

    socket.on("updateUserStatus", ({ userId, status }) => {
      setUserStatuses((prev) => ({ ...prev, [userId]: status }));
    });

    return () => {
      socket.off("newMessage");
      socket.off("typing");
      socket.off("stopTyping");
      socket.off("updateUserStatus");
    };
  }, [socket, selectedUser, user]);

  // ---- Send message ----
  const sendMessage = () => {
    if (!selectedUser) return;
    if (!newMessage.trim() && !file) return;

    const token = localStorage.getItem("token");

    if (selectedUser.isGroup) {
      axios
        .post(
          `${API_URL}/api/messages/sendGroup`,
          { groupId: selectedUser._id, from: user.name, text: newMessage },
          { headers: { Authorization: `Bearer ${token}` } }
        )
        .then(() => setNewMessage(""))
        .catch(console.error);
      return;
    }

    const url = file
      ? `${API_URL}/api/messages/sendMedia`
      : `${API_URL}/api/messages/send`;

    let request;
    if (file) {
      const formData = new FormData();
      formData.append("wa_id", selectedUser._id);
      formData.append("from", user.name);
      formData.append("text", newMessage);
      formData.append("file", file);
      request = axios.post(url, formData, {
        headers: { "Content-Type": "multipart/form-data", Authorization: `Bearer ${token}` },
      });
    } else {
      request = axios.post(
        url,
        { wa_id: selectedUser._id, from: user.name, text: newMessage },
        { headers: { Authorization: `Bearer ${token}` } }
      );
    }

    request
      .then(() => {
        setNewMessage("");
        setFile(null);
        socket.emit("stopTyping", { from: user._id, to: selectedUser._id });
      })
      .catch(console.error);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ---- Auth UI ----
  if (!user) {
    return (
      <div className="h-screen w-full flex items-center justify-center">
        <div className="absolute top-4 right-4">
          <button
            className="text-blue-600 underline"
            onClick={() => setShowRegister((s) => !s)}
          >
            {showRegister ? "Have an account? Login" : "New here? Register"}
          </button>
        </div>
        {showRegister ? <Register /> : <Login setUser={setUser} />}
      </div>
    );
  }

  // ---- Main Chat UI ----
  return (
    <div className="h-screen flex">
      {/* Sidebar */}
      <div className="w-1/3 bg-gray-100 border-r overflow-y-auto flex flex-col">
        <div className="p-4 font-bold text-lg flex items-center justify-between">
          <span>Conversations</span>
          <span className="text-xs text-gray-500">Hi, {user.name}</span>
        </div>
        <input
          type="text"
          placeholder="Search chats..."
          className="w-full p-2 border-b outline-none"
          value={convSearch}
          onChange={(e) => setConvSearch(e.target.value)}
        />
        <div className="flex-1 overflow-auto">
          {conversations.map((conv) => (
            <div
              key={conv._id}
              className={`p-4 border-b cursor-pointer ${
                selectedUser?._id === conv._id ? "bg-gray-300" : "hover:bg-gray-200"
              }`}
              onClick={() => {
                setSelectedUser(conv);
                setMessageSearch("");
              }}
            >
              <div className="flex justify-between items-center">
                <p className="font-semibold">
                  {conv.isGroup ? "👥 " : ""}
                  {conv.name || conv._id}
                </p>
                {conv.unreadCount > 0 && (
                  <span className="bg-green-500 text-white text-xs px-2 py-0.5 rounded-full">
                    {conv.unreadCount}
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-600">{conv.lastMessage}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Chat Pane */}
      <div className="flex-1 flex flex-col">
        {selectedUser ? (
          <>
            {/* Header */}
            <div className="p-4 bg-gray-200 border-b flex justify-between items-center">
              <div className="flex flex-col">
                <span>{userInfo?.name || selectedUser.name || "Unknown"}</span>
                <span className="text-sm text-gray-600">
                  {userStatuses[userInfo?._id] === "online" ? "Online" : "Offline"}
                </span>
                {isTyping && <span className="text-green-600 text-sm">Typing...</span>}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Search messages..."
                  className="border rounded p-1 text-sm"
                  value={messageSearch}
                  onChange={(e) => setMessageSearch(e.target.value)}
                />
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {messages
                .filter((msg) =>
                  (msg.text || "").toLowerCase().includes(messageSearch.toLowerCase())
                )
                .map((msg, i) => {
                  const time = msg.timestamp
                    ? new Date(msg.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "";

                  let StatusIcon = null;
                  if (msg.status === "sent") StatusIcon = <BsCheck className="inline text-gray-500" />;
                  else if (msg.status === "delivered") StatusIcon = <BsCheckAll className="inline text-gray-500" />;
                  else if (msg.status === "read") StatusIcon = <BsCheckAll className="inline text-blue-500" />;

                  const isIncoming = msg.from === selectedUser._id;

                  return (
                    <div
                      key={msg._id || i}
                      className={`p-2 rounded-lg max-w-xs flex flex-col ${
                        isIncoming ? "bg-white self-start" : "bg-green-200 self-end"
                      }`}
                    >
                      {msg.mediaUrl ? (
                        msg.mediaType?.startsWith("image/") ? (
                          <img
                            src={`${API_URL}${msg.mediaUrl}`}
                            alt=""
                            className="max-w-xs rounded-lg"
                          />
                        ) : msg.mediaType?.startsWith("video/") ? (
                          <video controls className="max-w-xs rounded-lg">
                            <source
                              src={`${API_URL}${msg.mediaUrl}`}
                              type={msg.mediaType}
                            />
                          </video>
                        ) : (
                          <a
                            href={`${API_URL}${msg.mediaUrl}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-500 underline"
                          >
                            Download File
                          </a>
                        )
                      ) : (
                        <span>{msg.text}</span>
                      )}
                      <div className="text-xs text-gray-500 self-end flex items-center gap-1 mt-1">
                        {time} {!isIncoming && StatusIcon}
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* Message Input */}
            <div className="p-4 border-t flex gap-2 items-center">
              <input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="hidden"
                id="fileUpload"
              />
              <label
                htmlFor="fileUpload"
                className="bg-gray-300 px-3 py-2 rounded-lg cursor-pointer select-none"
                title="Attach file"
              >
                📎
              </label>

              <input
                type="text"
                placeholder="Type a message..."
                className="flex-1 border rounded-lg px-3 py-2"
                value={newMessage}
                onChange={(e) => {
                  setNewMessage(e.target.value);
                  socket.emit("typing", { from: user?._id, to: selectedUser._id });
                  clearTimeout(window.typingTimeout);
                  window.typingTimeout = setTimeout(() => {
                    socket.emit("stopTyping", { from: user?._id, to: selectedUser._id });
                  }, 1000);
                }}
                onKeyDown={handleKeyDown}
              />

              <button
                onClick={sendMessage}
                className="bg-green-500 text-white px-4 py-2 rounded-lg"
              >
                Send
              </button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            Select a conversation
          </div>
        )}
      </div>
    </div>
  );
}

