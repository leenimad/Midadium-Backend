import React, { useState } from 'react';

function ProfileCard() {
  const [showDetailedBio, setShowDetailedBio] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);

  const toggleBio = () => {
    setShowDetailedBio(!showDetailedBio);
  };

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
  };

  const shortBio = "I'm a computer science student who loves coding!";
  const detailedBio = "I'm a computer science student at XYZ University. I love coding, especially frontend development with React. In my free time, I enjoy reading tech blogs, playing guitar, and hiking. I'm excited to build more projects and learn new technologies!";

  // Inline styles for the component
  const cardStyle = {
    maxWidth: '300px',
    margin: '50px auto',
    padding: '20px',
    borderRadius: '10px',
    textAlign: 'center',
    transition: 'all 0.3s ease',
    backgroundColor: isDarkMode ? '#333' : '#f9f9f9',
    color: isDarkMode ? '#f9f9f9' : '#333',
    border: `2px solid ${isDarkMode ? '#555' : '#ddd'}`
  };

  const imageStyle = {
    width: '100px',
    height: '100px',
    borderRadius: '50%',
    marginBottom: '15px'
  };

  const bioSectionStyle = {
    margin: '20px 0',
    padding: '15px',
    borderRadius: '5px',
    backgroundColor: 'rgba(0,0,0,0.1)'
  };

  const buttonStyle = {
    padding: '8px 16px',
    margin: '5px',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
    backgroundColor: '#007bff',
    color: 'white'
  };

  const themeButtonStyle = {
    ...buttonStyle,
    backgroundColor: '#28a745'
  };

  return (
    <div style={cardStyle}>
      <img 
        src="https://via.placeholder.com/150/4A90E2/FFFFFF?text=SJ" 
        alt="Profile" 
        style={imageStyle}
      />
      <h2>Sarah Johnson</h2>
      <p><strong>Age:</strong> 21</p>
      <p><strong>Hobby:</strong> Playing Guitar</p>
      <p><strong>Favorite Color:</strong> Blue 💙</p>
      
      <div style={bioSectionStyle}>
        <p>{showDetailedBio ? detailedBio : shortBio}</p>
        <button onClick={toggleBio} style={buttonStyle}>
          {showDetailedBio ? 'Show Less' : 'Show More'}
        </button>
      </div>
      
      <button onClick={toggleTheme} style={themeButtonStyle}>
        Switch to {isDarkMode ? 'Light' : 'Dark'} Mode
      </button>
    </div>
  );
}

export default ProfileCard;

/*
STUDENT EXPLANATION:
Name: Sarah Johnson
Assignment: Personal Profile Card Component

Hooks Used:
1. useState for showDetailedBio - toggles between short and detailed bio text
2. useState for isDarkMode - switches between light and dark theme colors

Features Implemented:
✅ Personal information display (name, age, hobby, favorite color)
✅ Bio toggle functionality with useState
✅ Theme toggle (light/dark mode)
✅ Profile picture with placeholder
✅ Inline CSS styling that changes based on theme

Challenges:
- Learning how to use inline styles with conditional rendering
- Understanding how useState works with boolean values
- Making the theme toggle affect multiple style properties

This component demonstrates basic React concepts including JSX, useState hook, 
event handling, and conditional rendering.
*/