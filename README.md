# Coffee-Concepts
<div align="center"> <br/> 
📚 Coffee-Concepts
Study Together. Stay Motivated. Get Things Done.
A live video study platform where focus meets community — join real-time study rooms, stay accountable with peers, and make learning a shared experience.
<br/> 




<br/> </div> 

🧠 What is Coffee-Concepts?
Coffee-Concepts is a web-based study motivation platform that brings the library vibe to your screen. Users join live video study rooms with cameras on, work alongside strangers and friends, and hold each other accountable — silently, powerfully.
No distractions. No pressure. Just a room full of people who also need to get stuff done.


✨ Features
Feature	Description
📹 Live Study Rooms	Join video rooms with time limits — everyone keeps cameras on to stay accountable
⏱️ Session Timer	Countdown timer visible on screen — know exactly how long the session lasts
💬 Study Buddy Requests	Send/receive chat requests from other users in the room
☕ Coffee Break Mode	5-minute break timer — step away and recharge, then get back to it
🌦️ Live Weather Widget	Optional real-time weather display based on your location
🎨 Custom Backgrounds	Personalize your room with background images or themes
🎵 Background Music	Add your own playlist or ambient sounds to study with


🚀 How It Works
1. 🏠 Enter the Platform
    • Create an account or log in
    • Browse available live study rooms or create your own
    • Each room shows: current members, subject/topic, and time remaining
2. 📹 Join a Room (Camera On)
    • Click Join Room — your camera activates automatically
    • You see a grid of all participants studying in real time
    • The session timer starts ticking on your screen (e.g., 25 min, 50 min, or custom)
    • Everyone can see each other — that's the whole point. Accountability.
3. 💬 Connect with Others
    • Spot someone studying the same subject? Hit Send Request
    • They receive a subtle notification — accept to open a private chat sidebar
    • Chat stays non-intrusive: text only, doesn't interrupt the room
4. ⏱️ Session Timer
    • The countdown is always visible (top/center of the screen)
    • When time's up → a soft end-of-session alert fires
    • Users can vote to extend the session or gracefully leave
5. ☕ Coffee Break (5 min)
    • Hit the Coffee Break button anytime
    • A 5-minute mini-timer starts
    • Your video feed shows a "On Break" badge — others know you'll be back
    • Break ends → back to focus mode automatically
6. 🌦️ Weather Widget (Optional)
    • Toggle the weather panel from the toolbar
    • Shows real-time conditions: temperature, sky, humidity
    • Useful for those who like knowing outside while staying inside
7. 🎨 Backgrounds & 🎵 Music
    • Open Settings Panel → Background tab
    • Upload an image, pick a preset (coffee shop, library, nature), or go solid color
    • Music tab: paste a playlist link or pick from built-in lo-fi / ambient playlists
    • Music plays locally — only you hear it
8. 🚪 Leave or Extend
    • Session ends → you're shown a summary: time studied, room members
    • Option to rate the session or jump into a new room


🏗️ Tech Stack
Frontend       → React.js / Next.js
Styling        → Tailwind CSS
Video/Audio    → WebRTC (peer-to-peer video)
Signaling      → Socket.io (real-time events)
Backend        → Node.js + Express
Database       → MongoDB / PostgreSQL
Auth           → Firebase Auth / NextAuth.js
Weather API    → OpenWeatherMap API
Deployment     → Vercel (frontend) + Railway/Render (backend)
 

📁 Project Structure
Coffee-Concepts/
├── client/                  # Frontend (React/Next.js)
│   ├── components/
│   │   ├── Room/            # Video room UI
│   │   ├── Timer/           # Session + break timers
│   │   ├── Chat/            # Buddy request & chat
│   │   ├── Weather/         # Weather widget
│   │   └── Settings/        # Background & music panel
│   ├── pages/
│   └── hooks/               # useWebRTC, useSocket, useTimer
│
├── server/                  # Backend (Node/Express)
│   ├── socket/              # WebSocket events
│   ├── routes/              # REST API routes
│   ├── models/              # DB models
│   └── controllers/
│
└── README.md
 

⚙️ Getting Started
Prerequisites
    • Node.js v18+
    • npm or yarn
    • MongoDB or PostgreSQL instance
Installation
# Clone the repo
git clone https://github.com/yourusername/Coffee-Concepts.git
cd Coffee-Concepts

# Install dependencies
cd client && npm install
cd ../server && npm install

# Set up environment variables
cp .env.example .env
# → Fill in your API keys (Weather, DB, Auth)

# Run development servers
# Terminal 1 - Backend
cd server && npm run dev

# Terminal 2 - Frontend
cd client && npm run dev
 
Open http://localhost:3000 — you're live!


🔧 Environment Variables
# Server
PORT=5000
MONGO_URI=your_mongodb_uri
JWT_SECRET=your_secret_key

# Client
NEXT_PUBLIC_SOCKET_URL=http://localhost:5000
NEXT_PUBLIC_WEATHER_API_KEY=your_openweathermap_key
NEXT_PUBLIC_FIREBASE_CONFIG=your_firebase_config
 

🗺️ Roadmap
    • [x] Live video rooms with WebRTC
    • [x] Session countdown timer
    • [x] Chat buddy request system
    • [x] Coffee break mode
    • [x] Weather widget
    • [x] Custom backgrounds
    • [x] Background music support
    • [ ] Room categories (Exam Prep, Deep Work, Language Learning...)
    • [ ] Study streak tracking & badges
    • [ ] Pomodoro mode
    • [ ] Mobile app (React Native)
    • [ ] Room recording / session playback
    • [ ] Leaderboards & study stats


🤝 Contributing
Contributions are welcome! Please follow these steps:
    1. Fork this repository
    2. Create a new branch: git checkout -b feature/your-feature-name
    3. Make your changes and commit: git commit -m "feat: add your feature"
    4. Push to your fork: git push origin feature/your-feature-name
    5. Open a Pull Request
Please read CONTRIBUTING.md for code style guidelines and contribution norms.


🐛 Reporting Issues
Found a bug or have a feature request? Open an Issue and use the appropriate template.


📄 License
This project is licensed under the MIT License — see the LICENSE file for details.


🙏 Acknowledgements
    • Inspired by the Focusmate and study-with-me YouTube culture
    • WebRTC magic powered by the open web
    • Lo-fi beats for keeping the vibe going ☕

<div align="center"> 
Made with ❤️ for students, by students.
⭐ Star this repo if Coffee-Concepts helped you focus!
</div>
