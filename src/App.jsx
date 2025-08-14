

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


  // ---- Socket ----
  const socket = io("https://whatsapp-backend-mf5s.onrender.com");

  // ---- Auth: restore session & axios headers ----
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;

    axios
      .get("https://whatsapp-backend-mf5s.onrender.com/api/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => {
        setUser(res.data);
        axios.defaults.headers.common["Authorization"] = `Bearer ${token}`;
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
  if (user) {
    socket.emit("userOnline", user._id);
  }
}, [user]);


  // ---- Fetch conversations with unread counts ----
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;

    axios
      .get("https://whatsapp-backend-mf5s.onrender.com/api/messages", {
        headers: { Authorization: `Bearer ${token}` },
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
  }, [convSearch, messages]);

  // ---- Fetch messages for selected conversation ----
 useEffect(() => {
  if (!selectedUser) return;
  const token = localStorage.getItem("token");

  // Fetch messages for group or normal conversation
  const endpoint = selectedUser.isGroup
    ? `https://whatsapp-backend-mf5s.onrender.com/api/messages/group/${selectedUser._id}`
    : `https://whatsapp-backend-mf5s.onrender.com/api/messages/${selectedUser._id}`;

  axios
    .get(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
    })
    .then((res) => setMessages(res.data || []))
    .catch((err) => console.error(err));

  // Mark messages as read only for normal chats
  if (!selectedUser.isGroup) {
    axios.post(
      `https://whatsapp-backend-mf5s.onrender.com/api/messages/markRead/${selectedUser._id}`,
      {},
      { headers: { Authorization: `Bearer ${token}` } }
    );
  }
}, [selectedUser]);

  // ---- Fetch user info for header ----
  useEffect(() => {
    if (!selectedUser || selectedUser.isGroup) return;
    const token = localStorage.getItem("token");
    axios
      .get(`https://whatsapp-backend-mf5s.onrender.com/api/messages/user/${selectedUser}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => setUserInfo(res.data))
      .catch(() => setUserInfo(null));
  }, [selectedUser]);

  // ---- Socket listeners ----
  useEffect(() => {
    if (!user) return;

    // New message
    socket.on("newMessage", (message) => {
      if (message?.wa_id === selectedUser) {
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
 
    //group messages
    if(selectedUser?.isGroup) {
      socket.on('groupMessage:${selectedUser._id}',
        (msg) => {
          setMessages((prev) => [...prev.msg]);
        }
      );
    }
    // Typing
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
    // ---- Listen for online/offline updates ----
socket.on("updateUserStatus", ({ userId, status }) => {
  setUserStatuses(prev => ({ ...prev, [userId]: status }));
});


    return () => socket.off("newMessage").off("typing").off("stopTyping");
  }, [selectedUser, user]);

  // ---- Export chat ----
  const exportChat = () => {
    if (!messages.length) return;
    const chatData = messages
      .map((msg) => {
        const time = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : "";
        return `${msg.from}: ${msg.text || ""} (${time})`;
      })
      .join("\n");

    const blob = new Blob([chatData], { type: "text/plain" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${selectedUser}_chat.txt`;
    link.click();
  };

  // ---- Send text/media ----
  const sendMessage = () => {
    if (!selectedUser) return;
    if (!newMessage.trim() && !file) return;

    const token = localStorage.getItem("token");

    //send group messages
    if(selectedUser.isGroup)
    {
      axios.post(
        'https://whatsapp-backend-mf5s.onrender.com/api/messages/sendGroup',
        {
          groupId: selectedUser._id,
          from: user.name,
          text: newMessage
        },
        {
          headers: {Authorization: `Bearer ${token}`}
        }
      );
      setNewMessage("");
      return;
    }

    const url = file
      ? "https://whatsapp-backend-mf5s.onrender.com/api/messages/sendMedia"
      : "https://whatsapp-backend-mf5s.onrender.com/api/messages/send";

    let request;
    if (file) {
      const formData = new FormData();
      formData.append("wa_id", selectedUser);
      formData.append("from", user?.name || "You");
      formData.append("to", selectedUser);
      formData.append("text", newMessage);
      formData.append("file", file);
      request = axios.post(url, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
    } else {
      const payload = {
        wa_id: selectedUser,
        from: user?.name || "You",
        to: selectedUser,
        text: newMessage,
      };
      request = axios.post(url, payload);
    }

    request
      .then(() => {
        setNewMessage("");
        setFile(null);
        // Stop typing after send
        socket.emit("stopTyping", { from: user?._id, to: selectedUser });
      })
      .catch((err) => console.error(err));
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleNewGroup = () => {
  const groupName = prompt("Enter group name:");
  if (!groupName) return;

  // Step 3: Ask user to select members
  const selectedMembers = prompt("Enter member IDs (comma-separated):");
  const membersArray = selectedMembers ? selectedMembers.split(",").map(m => m.trim()) : [];

  const token = localStorage.getItem("token");
  axios.post("https://whatsapp-backend-mf5s.onrender.com:/api/groups", {
    name: groupName,
    members: membersArray
  }, {
    headers: { Authorization: `Bearer ${token}` }
  }).then(res => {
    alert("Group created! Refresh conversation list.");
  });
};



  // ---- Auth gate ----
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

  // ---- Chat UI ----
  return (
    <div className="h-screen flex">
      {/* Left Sidebar */}
      <div className="w-1/3 bg-gray-100 border-r overflow-y-auto flex flex-col">
        <div className="p-4 font-bold text-lg flex items-center justify-between">
          <span>Conversations</span>
          <span className="text-xs text-gray-500">Hi, {user.name}</span>
        </div>
             
             {/* ✅ New Group Button */}
        <button
          className="w-full p-2 bg-blue-500 text-white rounded mb-2"
          onClick={handleNewGroup}
        >
          + New Group
        </button>

 
        

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
                selectedUser === conv._id ? "bg-gray-300" : "hover:bg-gray-200"
              }`}
              onClick={() => {
                setSelectedUser(conv._id);
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

      {/* Right Pane */}
      <div className="flex-1 flex flex-col">
        {selectedUser ? (
          <>
            <div className="p-4 bg-gray-200 border-b flex justify-between items-center">
              <div className="flex flex-col">
                <span>{userInfo?.name || "Unknown"}</span>
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
                <button
                  onClick={exportChat}
                  className="bg-blue-500 text-white px-3 py-1 rounded text-sm"
                >
                  Export
                </button>
              </div>
            </div>

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

                  const isIncoming = msg.from === selectedUser;

                  return (
                    <div
                      key={msg._id || i}
                      className={`p-2 rounded-lg max-w-xs flex flex-col ${
                        isIncoming ? "bg-white self-start" : "bg-green-200 self-end"
                      }`}
                    >
                      {msg.mediaUrl ? (
                        msg.mediaType?.startsWith("image/") ? (
                          <img src={`https://whatsapp-backend-mf5s.onrender.com${msg.mediaUrl}`} alt="" className="max-w-xs rounded-lg" />
                        ) : msg.mediaType?.startsWith("video/") ? (
                          <video controls className="max-w-xs rounded-lg">
                            <source src={`https://whatsapp-backend-mf5s.onrender.com${msg.mediaUrl}`} type={msg.mediaType} />
                          </video>
                        ) : (
                          <a
                            href={`https://whatsapp-backend-mf5s.onrender.com${msg.mediaUrl}`}
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

            <div className="p-4 border-t flex gap-2 items-center">
              <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} className="hidden" id="fileUpload" />
              <label htmlFor="fileUpload" className="bg-gray-300 px-3 py-2 rounded-lg cursor-pointer select-none" title="Attach file">📎</label>

              <input
                type="text"
                placeholder="Type a message..."
                className="flex-1 border rounded-lg px-3 py-2"
                value={newMessage}
                onChange={(e) => {
                  setNewMessage(e.target.value);
                  socket.emit("typing", { from: user?._id, to: selectedUser });
                  clearTimeout(window.typingTimeout);
                  window.typingTimeout = setTimeout(() => {
                    socket.emit("stopTyping", { from: user?._id, to: selectedUser });
                  }, 1000);
                }}
                onKeyDown={handleKeyDown}
              />

              <button onClick={sendMessage} className="bg-green-500 text-white px-4 py-2 rounded-lg">
                Send
              </button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">Select a conversation</div>
        )}
      </div>
    </div>
  );
}