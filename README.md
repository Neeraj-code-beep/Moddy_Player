# 🎧 Moddy Player

![React](https://img.shields.io/badge/Frontend-React-blue)
![Node](https://img.shields.io/badge/Backend-Node.js-green)
![Express](https://img.shields.io/badge/Framework-Express-black)
![MongoDB](https://img.shields.io/badge/Database-MongoDB-darkgreen)
![Tailwind](https://img.shields.io/badge/UI-TailwindCSS-38B2AC)
![FaceAPI](https://img.shields.io/badge/AI-face--api.js-orange)
![Storage](https://img.shields.io/badge/Storage-ImageKit-purple)

Moddy Player is an experimental **AI-powered mood-based music recommendation web application**.

The app detects a user's **facial expression through their webcam**, determines their **current mood**, and suggests songs accordingly.

This project mainly focuses on **core functionality and system architecture**, combining **Computer Vision, AI concepts, and Web Development**.

---

# 🚀 Project Overview

The goal of **Moddy Player** is to explore how **facial emotion recognition** can be used to recommend music dynamically.

Instead of asking users what they want to listen to, the system analyzes their **facial expressions and automatically suggests songs**.

---

# 🧠 How It Works

1. User opens the application  
2. Webcam captures the user's face  
3. **face-api.js** detects facial expressions  
4. The system predicts the user's **mood**  
5. Mood is sent to the **Node.js backend**  
6. Backend fetches songs from **MongoDB**  
7. Songs are displayed to the user  

---

# 🛠 Tech Stack

## Frontend
- React
- TailwindCSS
- face-api.js
- Vite

## Backend
- Node.js
- Express.js

## Database
- MongoDB

## Storage
- ImageKit (for storing songs)

---

# 📂 Project Structure

```
moddy-player
│
├── server.js                 # Express backend server
│
├── frontend
│   ├── public
│   │
│   ├── src
│   │   ├── api
│   │   │   └── api.js        # API requests
│   │   │
│   │   ├── components
│   │   │   ├── MoodDetector.jsx   # Detects user mood
│   │   │   └── MoodSongs.jsx      # Displays recommended songs
│   │   │
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css
│   │
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── eslint.config.js
│
├── .gitignore
├── README.md
└── Notes.md
```

---

# 🎯 Current Features

- Face detection using webcam
- Mood detection using facial expressions
- Song recommendation based on mood
- Song storage using ImageKit
- MongoDB for storing song metadata
- React frontend with TailwindCSS

---

# ⚠️ Current Limitations

- UI is very basic
- Songs are manually uploaded
- No authentication system yet
- Limited dataset of songs

This project mainly focuses on **learning and experimenting with AI + Web Development**.

---

# 🔮 Future Plans

Planned improvements include:

- Using **Gemini AI** to automatically classify songs by genre and mood
- Automatic mood tagging of songs
- Spotify API integration
- Mood analytics and listening history
- Improved UI/UX
- Personalized recommendations

---

# ⚙️ Running the Project Locally

## 1. Fork the Repository

Click the **Fork** button on the top-right of the GitHub repository.

---

## 2. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/moddy-player.git
```

---

## 3. Navigate to the Project

```bash
cd moddy-player
```

---

# 🔧 Backend Setup

Install dependencies:

```bash
npm install
```

Run the backend server:

```bash
node server.js
```

Backend server will start at:

```
http://localhost:5000
```

---

# 🎨 Frontend Setup

Open a new terminal and run:

```bash
cd frontend
npm install
npm run dev
```

Frontend will run at:

```
http://localhost:5173
```

---

# 🔑 Environment Variables

Create a `.env` file in the root directory and add the following:

```
MONGO_URI=your_mongodb_connection_string

IMAGEKIT_PUBLIC_KEY=your_public_key
IMAGEKIT_PRIVATE_KEY=your_private_key
IMAGEKIT_URL_ENDPOINT=your_url_endpoint
```

---

# 🤝 Contributing

Contributions are welcome.

Steps to contribute:

1. Fork the repository

2. Create a new branch

```
git checkout -b feature-name
```

3. Commit your changes

```
git commit -m "Added new feature"
```

4. Push your branch

```
git push origin feature-name
```

5. Open a Pull Request

---

## 💖 Contributors

Thanks to all the amazing people who contribute to **Moddy_Player** 🚀

<p align="center">
  <a href="https://github.com/Neeraj-code-beep/Moddy_Player/graphs/contributors">
    <img src="https://contrib.rocks/image?repo=Neeraj-code-beep/Moddy_Player" alt="Contributors"/>
  </a>
</p>

---

## ⭐ Project Support

<p align="center">
  <a href="https://github.com/Neeraj-code-beep/Moddy_Player/stargazers">
    <img src="https://img.shields.io/github/stars/Neeraj-code-beep/Moddy_Player?style=social" alt="Stars">
  </a>
  &nbsp;&nbsp;
  <a href="https://github.com/Neeraj-code-beep/Moddy_Player/network/members">
    <img src="https://img.shields.io/github/forks/Neeraj-code-beep/Moddy_Player?style=social" alt="Forks">
  </a>
</p>

---

# 👨‍💻 Author

Neeraj Mishra

This project was built to experiment with:

- AI + Computer Vision
- Emotion Detection
- Music Recommendation Systems
- Full Stack Development

---

# ⭐ Support

If you like this project, consider giving it a **star on GitHub**.
