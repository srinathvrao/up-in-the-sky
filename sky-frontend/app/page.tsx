'use client'

import { useState } from 'react';
// import Cookies from 'js-cookie';

function App() { 
  
  const [isHovered2, setIsHovered2] = useState(false);
  const [buttonText2, setButtonText2] = useState("Click this");

  return (
    <div style={styles.background}>
    <div style={styles.container}>
    <div style={styles.board}>
      <h1>Hello</h1>
        <br></br>
        <a
          href="#"
          style={isHovered2 ? { ...styles.button, ...styles.hover } : styles.button}
          onMouseEnter={() => setIsHovered2(true)}
          onMouseLeave={() => setIsHovered2(false)}
          onClick={() => { setButtonText2("World!");}}
        >
          {buttonText2}
        </a>
        <br></br>
  </div>
  </div>
  </div>
  );
}

// Styles
// ----------
const styles: Record<string, React.CSSProperties> = {
    background: {
      width: '100vw',
      height: '100vh',
      backgroundColor: '#121212',
      color: '#ffffff',          
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      margin: '-8px',
      padding: 0,
    },
    board: {
      boxSizing: 'inherit',
      display: 'flex',
      justifyContent: 'center',
      textAlign: 'center',
      flexDirection: 'column',
      alignItems: 'center',
      width: 'min(50vw, 50vh)',
      height: 'auto',
      marginBottom: '20px',
    },
    container: {
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      margin: 0,
      padding: 0,
      boxSizing: 'border-box',
    },
   
    button: {
      textDecoration: 'none',
      fontSize: '18px',
      fontWeight: 'bold',
      color: '#fff',
      backgroundColor: '#6c63ff',
      padding: '15px 30px',
      borderRadius: '50px',
      transition: 'transform 0.3s ease, box-shadow 0.3s ease',
      boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
      cursor: 'pointer',
      textAlign: 'center' as const,
    },
    hover: {
      transform: 'scale(1.05)',
      boxShadow: '0 6px 12px rgba(0, 0, 0, 0.2)',
    },
  }
  
export default App
