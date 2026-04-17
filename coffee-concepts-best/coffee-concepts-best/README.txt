# Coffee & Concepts Best

A web application for studying and connecting with others through gendered study rooms, real-time chat, note-taking, and productivity tracking.

## Project Overview

**Coffee & Concepts** is a full-stack web application built with Node.js and Socket.io that enables users to:
- Sign up securely with email, username, gender, and password
- Join gender-balanced study rooms for focused learning
- Share real-time chat and collaborate with roommates
- Track personal study statistics (minutes, sessions, streaks)
- Manage notes and todo lists
- Switch between multiple UI themes

## Tech Stack

### Backend
- **Express.js** - Web framework
- **Socket.io** - Real-time bidirectional communication
- **Node.js** - Runtime

### Authentication & Security
- **bcryptjs** - Password hashing
- **jsonwebtoken (JWT)** - Session tokens
- **UUID** - Unique user IDs

### Data Storage
- **JSON file-based** - Users data stored in `server/data/users.json`

### Frontend
- Vanilla JavaScript
- Responsive CSS with custom theme system
- 4 built-in themes: Coffee, Night, Monochrome, Forest

## Project Structure

```
coffee-concepts-best/
├── package.json              # Dependencies and scripts
├── server/
│   ├── index.js             # Main Express server & Socket.io setup
│   └── data/
│       └── users.json       # User data storage
└── public/
    ├── index.html           # Frontend application
    └── [assets]             # CSS, JS, fonts
```

## Installation

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn

### Setup Steps

1. **Clone/Navigate** to the project directory:
   ```bash
   cd "coffee and conc/coffee-concepts-best"
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment** (optional):
   Create a `.env` file in the root directory:
   ```env
   PORT=4000
   JWT_SECRET=your-secret-key-here
   ADMIN_EMAILS=admin@test.com,admin2@test.com
   ```

   Environment variables:
   - `PORT` - Server port (default: 4000)
   - `JWT_SECRET` - JWT signing secret (default: 'cc-dev-secret-2024')
   - `ADMIN_EMAILS` - Comma-separated list of admin email addresses

## Running the Application

### Development Mode

```bash
npm start
```
or
```bash
npm run dev
```

The server will start on `http://localhost:4000` (or custom PORT if specified).

### Access the Application

Open your browser and navigate to:
```
http://localhost:4000
```

## Features

### 1. User Authentication
- **Signup**: Create account with email, username, gender, and password
- **Login**: JWT-based authentication
- **Password Security**: bcrypt hashing with salt rounds

### 2. Study Rooms
- Gender-separated rooms to maintain safe study environments
- Join/leave rooms dynamically
- Room capacity management
- Real-time room member updates

### 2.1 Room Access Rules
- **Guests** can only see and join **neutral** rooms.
- **Signed-in users** can see neutral rooms plus rooms matching their selected gender:
  - `female` users see **women-only** rooms
  - `male` users see **men-only** rooms

### 3. Real-Time Features
- **Live Chat**: Socket.io-powered messaging in study rooms
- **Rate Limiting**: Prevent chat spam
- **User Presence**: See who's currently in the room

### 4. Productivity Tracking
- Track total study minutes
- Sessions completed counter
- Current streak tracking
- Weekly study minutes breakdown (7-day history)
- Last study date recording
- Weekly reset on configured day

### 5. Notes & Todos
- Create and manage personal notes
- Categorized todo lists
- Persistent storage per user

### 6. Admin Panel
- Admin access based on email configuration (`ADMIN_EMAILS`)
- User management capabilities
- System monitoring

### 7. Themes
Switch between 4 visual themes:
- **Coffee** (default) - Warm brown tones
- **Night** - Cool blue tones
- **Monochrome** - Grayscale palette
- **Forest** - Green nature theme

## API Endpoints

### REST API
- `GET /` - Serve frontend (index.html)
- `POST /signup` - User registration
- `POST /login` - User authentication
- `GET /profile` - User profile info
- `PUT /profile` - Update profile
- `GET /stats` - User statistics

### Socket.io Events

**Client → Server:**
- `join-room` - Join a study room
- `leave-room` - Leave current room
- `send-message` - Send chat message
- `create-todo` - Add new todo
- `update-todo` - Modify todo
- `delete-todo` - Remove todo
- `update-note` - Save personal note

**Server → Client:**
- `room-joined` - Confirmation of room join
- `room-updated` - Member list update
- `message-received` - New chat message
- `user-online` - User joined room
- `user-offline` - User left room

## Admin Access Setup

Admin users have the ability to create/manage rooms, view user statistics, and access admin features.

### Method 1: Use Default Admin Account (Simplest)

A default admin account is pre-created in the system:
- **Username**: `Adm`
- **Email**: `admin@test.com`

To login with this account and see the password:
1. Check [server/data/users.json](server/data/users.json)
2. The password is bcrypt-hashed, so you need to use the **signup feature**
3. **Sign up with the email `admin@test.com`** and create a new password
4. It will automatically be marked as admin

### Method 2: Create Admin from Your Own Email

To make your own signup account an admin:

1. **Before signing up**, set your email in the `.env` file:
   ```env
   ADMIN_EMAILS=your-email@example.com,another-admin@example.com
   ```

2. **Restart the server**:
   ```bash
   npm start
   ```

3. **Sign up** with the email you added to `ADMIN_EMAILS`
   - You will automatically be granted admin privileges

### Method 3: Grant Admin to Existing User

Edit `server/data/users.json` directly:
```json
{
  "id": "user-uuid",
  "username": "username",
  "email": "user@example.com",
  "isAdmin": true,        // ← Change this to true
  ...
}
```

Then restart the server for changes to take effect.

### Admin Features  
- Create custom study rooms
- Delete/manage existing rooms
- View user statistics and leaderboard
- Manage user accounts
- Access admin dashboard (if implemented)

## Data Storage

### User Object Structure
```json
{
  "id": "uuid-string",
  "username": "username",
  "email": "email@example.com",
  "gender": "male|female|other",
  "passwordHash": "bcrypt-hash",
  "genderLocked": false,
  "isAdmin": false,
  "createdAt": 1776007869610,
  "avatar": "AD",
  "todos": [],
  "personalNote": "",
  "stats": {
    "totalMinutes": 0,
    "sessionsCompleted": 0,
    "streak": 0,
    "lastStudyDate": null,
    "weeklyMinutes": [0, 0, 0, 0, 0, 0, 0],
    "weekReset": "2026-04-11"
  }
}
```

## Security Considerations

⚠️ **Development Only**: This application uses file-based JSON storage and is suitable for development and testing only.

For production:
- Use a proper database (MongoDB, PostgreSQL, etc.)
- Implement proper OAuth/OIDC instead of JWT
- Use bcryptjs with higher salt rounds (default: 10)
- Implement HTTPS
- Add rate limiting for all endpoints
- Add CSRF protection
- Sanitize all user inputs
- Use environment-based secrets management

## Troubleshooting

### Port Already in Use
If port 4000 is in use, specify a different port:
```bash
PORT=5000 npm start
```

### Module Not Found
Ensure all dependencies are installed:
```bash
npm install
```

### Socket.io Connection Issues
- Check that CORS is properly configured
- Ensure client is connecting to correct server URL
- Verify firewall settings allow WebSocket connections

### Users Not Persisting
- Check that `server/data/` directory exists
- Ensure write permissions on `users.json`
- Verify JSON format is valid

## Development Notes

- Hot reload is not configured; restart server for changes
- Logs output to console (consider using winston/morgan for production)
- Socket.io has 60s ping timeout configured
- Max JSON payload: 1MB

## License

Private project - Coffee & Concepts Best

## Support

For issues or questions, check the server logs in the terminal for detailed error messages.
