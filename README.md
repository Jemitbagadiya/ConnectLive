# ConnectLive

A full-stack private real-time chat application built with React, Node.js, Express, Socket.IO, and MongoDB Atlas. Users can register, log in, connect with other registered users, and exchange messages in real time.

## Features

- **Authentication:** User registration and login using JWT and bcryptjs.
- **Connections:** Add other registered users using their email addresses.
- **Real-Time Messaging:** Send and receive messages using Socket.IO.
- **Message History:** Store and retrieve messages using MongoDB Atlas.
- **Reply to Messages:** Reply to existing messages in a conversation.
- **Emoji Reactions:** React to messages with emoji reactions.
- **Message Deletion:** Delete messages for yourself or for everyone, where supported.
- **Read Receipts:** View message delivery/read status as implemented.
- **Online Presence:** Display connection status.
- **Typing Indicators:** See when another user is typing.
- **Keyboard Shortcuts:**
  - `Enter` — Send a message.
  - `Shift + Enter` — Insert a new line.
- **Responsive UI:** Chat interface designed for different screen sizes.
- **Theme Support:** Light and dark themes.

## Tech Stack

### Frontend
- React
- Vite
- TypeScript
- CSS

### Backend
- Node.js
- Express.js
- TypeScript
- Socket.IO

### Database and Security
- MongoDB Atlas
- Mongoose
- JSON Web Tokens (JWT)
- bcryptjs

## Requirements

- Node.js 20 or later
- npm
- MongoDB Atlas account or a local MongoDB instance
- Git

## Project Structure

```text
ConnectLive/
├── client/
│   ├── src/
│   ├── .env.example
│   └── package.json
├── server/
│   ├── src/
│   ├── .env.example
│   └── package.json
├── .gitignore
├── package.json
└── README.md
```

## Run Locally

### 1. Clone the Repository

```bash
git clone https://github.com/Jemitbagadiya/ConnectLive.git
cd ConnectLive
```

### 2. Install Dependencies

```bash
npm install
npm run install:all
```

### 3. Configure Environment Variables

Create `server/.env` using `server/.env.example`.

```env
PORT=5000
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_long_random_secret
CLIENT_URL=http://localhost:5173
NODE_ENV=development
```

Create `client/.env` using `client/.env.example`.

```env
VITE_API_URL=http://localhost:5000/api
VITE_SOCKET_URL=http://localhost:5000
```

Replace the example values with your actual configuration. Never commit real credentials, database connection strings, or secrets to GitHub.

### 4. Start the Application

From the project root, run:

```bash
npm run dev
```

Open the Vite development URL shown in the terminal, usually:

http://localhost:5173

### 5. Test Messaging

1. Register two different user accounts.
2. Open the application in two separate browser sessions.
3. Add the other user using their registered email address.
4. Open the conversation.
5. Send messages and test replies, reactions, read receipts, and keyboard shortcuts.

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Run frontend and backend in development |
| `npm run build` | Build the frontend and backend |
| `npm run start` | Start the compiled backend after building |

## Environment Variables

### Backend — `server/.env`

| Variable | Description |
|---|---|
| `PORT` | Backend port; defaults to 5000 |
| `MONGODB_URI` | MongoDB connection string |
| `JWT_SECRET` | Secret used for JWT signing |
| `CLIENT_URL` | Allowed frontend origin |
| `NODE_ENV` | Application environment |

### Frontend — `client/.env`

| Variable | Description |
|---|---|
| `VITE_API_URL` | Backend API base URL |
| `VITE_SOCKET_URL` | Backend Socket.IO server URL |

## Deployment

The project can be deployed using services such as Vercel for the frontend and Render for the backend.

For production deployment:

- Configure the correct environment variables on each hosting platform.
- Set `CLIENT_URL` to the deployed frontend origin.
- Configure MongoDB Atlas network access securely.
- Use HTTPS in production.
- Keep JWT secrets and database credentials private.
- Verify API and Socket.IO connectivity after deployment.

## Security and Future Improvements

This project is a learning-oriented chat application. Before using it as a public production service, consider adding:

- Email verification and password reset.
- Stronger automated and integration tests.
- User blocking, reporting, and moderation.
- Rate limiting and improved abuse protection.
- Audit logging and security monitoring.
- Secure image and file uploads.

## Author

**Jemit Bagadiya**

- GitHub: https://github.com/jemitbagadiya
- LinkedIn: https://www.linkedin.com/in/jemitbagadiya/
- Portfolio: https://jemitbagadiya.vercel.app/

## License

Add a license file if you intend to distribute this project for reuse or modification.