import React, { useState, useEffect, useRef, FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI, Chat, GenerateContentResponse } from "@google/genai";

const GURKUL_SYSTEM_INSTRUCTION = `You are a 'Gurukul,' a deeply personal, adaptive, and persistent AI mentor. Your purpose is to accompany the user throughout their life, fostering not just the acquisition of knowledge, but the development of wisdom, resilience, and a love for learning. 
Your tone is patient, wise, and encouraging, drawing inspiration from the Bhagavad Gita's philosophy on knowledge and service. 
You adapt your teaching style to the user's needs, connecting new concepts to their passions and teaching mental models for thinking, not just facts. 
You are a stable, reliable guide for their entire life.
When responding, do not use markdown. If the user asks a question that requires up-to-date information, use your available tools to find the answer.`;

interface Source {
    uri: string;
    title: string;
}
interface Message {
  role: 'user' | 'model';
  text: string;
  sources?: Source[];
}

interface UserSettings {
    chatHistory: Message[];
    activePlugins: {
        googleSearch: boolean;
    };
}

interface UserData {
    [username: string]: UserSettings;
}

// --- LocalStorage Helper Functions ---
const getStoredUsers = (): UserData => {
    const data = localStorage.getItem('gurukul_users');
    return data ? JSON.parse(data) : {};
};

const saveUsers = (users: UserData) => {
    localStorage.setItem('gurukul_users', JSON.stringify(users));
};

const getCurrentUser = (): string | null => {
    return localStorage.getItem('gurukul_currentUser');
};

const setCurrentUser = (username: string) => {
    localStorage.setItem('gurukul_currentUser', username);
};

const clearCurrentUser = () => {
    localStorage.removeItem('gurukul_currentUser');
};
// --- End Helper Functions ---


const LoginScreen = ({ onLogin }: { onLogin: (username: string) => void }) => {
    const [username, setUsername] = useState('');

    const handleSubmit = (e: FormEvent) => {
        e.preventDefault();
        if (username.trim()) {
            onLogin(username.trim());
        }
    };

    return (
        <div className="login-container">
            <h1>Welcome to Project Gurukul</h1>
            <p>Your personal AI mentor for a lifelong journey of learning and discovery. Please enter your name to begin or continue your journey.</p>
            <form className="login-form" onSubmit={handleSubmit}>
                <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter your name"
                    aria-label="Username"
                    autoFocus
                />
                <button type="submit" disabled={!username.trim()}>
                    Begin Journey
                </button>
            </form>
        </div>
    );
};

const Sidebar = ({ isOpen, activePlugins, onPluginToggle }: { isOpen: boolean, activePlugins: { googleSearch: boolean }, onPluginToggle: (plugin: string, isActive: boolean) => void }) => {
    return (
        <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
            <div className="sidebar-header">Tools & Plugins</div>
            <ul className="plugin-list">
                <li className="plugin-item">
                    <label htmlFor="google-search-toggle">Google Search</label>
                    <label className="toggle-switch">
                        <input 
                            type="checkbox" 
                            id="google-search-toggle"
                            checked={activePlugins.googleSearch}
                            onChange={(e) => onPluginToggle('googleSearch', e.target.checked)}
                        />
                        <span className="slider"></span>
                    </label>
                </li>
            </ul>
        </aside>
    );
}


const App = () => {
  const [currentUser, setUser] = useState<string | null>(null);
  const [chat, setChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [userInput, setUserInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [activePlugins, setActivePlugins] = useState({ googleSearch: false });
  const chatHistoryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const user = getCurrentUser();
    if (user) {
        handleLogin(user);
    }
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    const initializeChat = async () => {
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
            const allUsers = getStoredUsers();
            const userHistory = allUsers[currentUser]?.chatHistory || [];

            const newChat = ai.chats.create({
                model: 'gemini-2.5-flash',
                config: { systemInstruction: GURKUL_SYSTEM_INSTRUCTION },
                history: userHistory.map(msg => ({
                    role: msg.role,
                    parts: [{ text: msg.text }]
                }))
            });
            setChat(newChat);
        } catch (e) {
            console.error(e);
            setError("Failed to initialize the AI. Please check your API key and refresh the page.");
        }
    };
    initializeChat();
  }, [currentUser]);
  
  useEffect(() => {
    if (chatHistoryRef.current) {
      chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const handleLogin = (username: string) => {
    const allUsers = getStoredUsers();
    const userSettings = allUsers[username] || { chatHistory: [], activePlugins: { googleSearch: false } };
    setMessages(userSettings.chatHistory);
    setActivePlugins(userSettings.activePlugins);
    setUser(username);
    setCurrentUser(username);
  };

  const handleLogout = () => {
      clearCurrentUser();
      setUser(null);
      setMessages([]);
      setChat(null);
      setSidebarOpen(false);
  }
  
  const handlePluginToggle = (plugin: string, isActive: boolean) => {
    if (!currentUser) return;

    const updatedPlugins = { ...activePlugins, [plugin]: isActive };
    setActivePlugins(updatedPlugins);
    
    const allUsers = getStoredUsers();
    if (allUsers[currentUser]) {
        allUsers[currentUser].activePlugins = updatedPlugins;
        saveUsers(allUsers);
    }
  };

  const handleSendMessage = async (e: FormEvent) => {
    e.preventDefault();
    if (!userInput.trim() || !chat || isLoading || !currentUser) return;

    const userMessage: Message = { role: 'user', text: userInput };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setUserInput('');
    setIsLoading(true);
    setError(null);

    try {
        let response: GenerateContentResponse;
        let finalModelMessage: string;
        let sources: Source[] | undefined = undefined;

        if (activePlugins.googleSearch) {
            response = await chat.sendMessage({ 
                message: userInput,
                config: { tools: [{googleSearch: {}}] }
            });
            finalModelMessage = response.text;
            const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
            if (groundingChunks) {
                sources = groundingChunks
                    .filter((chunk: any) => chunk.web && chunk.web.uri && chunk.web.title)
                    .map((chunk: any) => ({ uri: chunk.web.uri, title: chunk.web.title }));
            }
        } else {
            const result = await chat.sendMessageStream({ message: userInput });
            let currentModelMessage = '';
            setMessages(prev => [...prev, { role: 'model', text: '...' }]);
            for await (const chunk of result) {
                currentModelMessage += chunk.text;
                setMessages(prev => {
                    const newMessages = [...prev];
                    newMessages[newMessages.length - 1] = { ...newMessages[newMessages.length - 1], text: currentModelMessage };
                    return newMessages;
                });
            }
            finalModelMessage = currentModelMessage;
        }

        const modelMessage: Message = { role: 'model', text: finalModelMessage, sources };
        const finalMessages = [...updatedMessages, modelMessage];
        
        // If not streaming, replace the placeholder, else it's already updated
        if (activePlugins.googleSearch) {
             setMessages(finalMessages);
        } else {
            // The last message was the streamed one, just need to update it in history
             setMessages(prev => {
                const newMessages = [...prev];
                newMessages[newMessages.length - 1] = modelMessage;
                return newMessages;
            });
        }


        const allUsers = getStoredUsers();
        allUsers[currentUser] = { ...allUsers[currentUser], chatHistory: finalMessages };
        saveUsers(allUsers);

    } catch (err) {
      console.error(err);
      setError("Sorry, something went wrong while getting a response. Please try again.");
      setMessages(updatedMessages); 
    } finally {
      setIsLoading(false);
    }
  };

  if (!currentUser) {
    return (
        <div className="app-container centered">
            <LoginScreen onLogin={handleLogin} />
        </div>
    );
  }

  return (
    <div className="app-container">
      <Sidebar isOpen={isSidebarOpen} activePlugins={activePlugins} onPluginToggle={handlePluginToggle} />
      <header>
        <button onClick={() => setSidebarOpen(!isSidebarOpen)} className="menu-btn" aria-label="Toggle tools menu">
            &#9776;
        </button>
        <span className="title">Project Gurukul</span>
        <button onClick={handleLogout} className="switch-user-btn">Switch User</button>
      </header>
      <main className="chat-history" ref={chatHistoryRef}>
        {messages.length === 0 && !isLoading && (
            <div className="welcome-message">
                <h2>Welcome to your Digital Gurukul, {currentUser}</h2>
                <p>Your lifelong journey of learning and discovery begins here. What are you curious about today?</p>
            </div>
        )}
        {messages.map((msg, index) => (
          <div key={index} className={`message-container ${msg.role}-message`}>
            <div className={`message ${msg.role}-message`}>
                {msg.role === 'model' && <span className="role">Gurukul</span>}
                <div>{msg.text}</div>
            </div>
            {msg.sources && msg.sources.length > 0 && (
                <div className="sources-container">
                    <h4>Sources:</h4>
                    <ul>
                        {msg.sources.map((source, i) => (
                            <li key={i}>
                                <a href={source.uri} target="_blank" rel="noopener noreferrer">
                                    {source.title || source.uri}
                                </a>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
          </div>
        ))}
         {isLoading && (
             <div className="loading-indicator">
                <span></span>
                <span></span>
                <span></span>
            </div>
        )}
      </main>
       {error && <p className="error-message">{error}</p>}
      <form className="chat-input-form" onSubmit={handleSendMessage}>
        <input
          type="text"
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          placeholder="Ask your mentor anything..."
          aria-label="Chat input"
          disabled={isLoading || !chat}
        />
        <button type="submit" disabled={isLoading || !userInput.trim() || !chat} aria-label="Send message">
          <span>&#10148;</span>
        </button>
      </form>
    </div>
  );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);
