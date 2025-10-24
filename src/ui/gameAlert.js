/**
 * Game Alert System
 * Simple centered alerts that appear over the game view
 */

class GameAlert {
  constructor() {
    this.currentAlert = null;
  }

  /**
   * Show a game alert
   * @param {string} message - The message to display
   * @param {string} buttonText - Text for the button (default: "OK")
   */
  show(message, buttonText = 'OK') {
    // Remove existing alert if any - immediately, not with fade out
    if (this.currentAlert) {
      if (this.currentAlert.parentNode) {
        this.currentAlert.parentNode.removeChild(this.currentAlert);
      }
      this.currentAlert = null;
    }

    // Create overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.6);
      z-index: 10002;
      display: flex;
      justify-content: center;
      align-items: center;
      animation: fadeIn 0.15s ease-out;
    `;

    // Create alert box
    const alertBox = document.createElement('div');
    alertBox.style.cssText = `
      background: white;
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      min-width: 320px;
      max-width: 500px;
      animation: scaleIn 0.2s ease-out;
      overflow: hidden;
    `;

    // Message
    const messageEl = document.createElement('div');
    messageEl.style.cssText = `
      padding: 32px 28px;
      font-size: 18px;
      line-height: 1.5;
      color: #333;
      text-align: center;
      font-weight: 500;
    `;
    messageEl.textContent = message;

    // Button
    const button = document.createElement('button');
    button.style.cssText = `
      width: 100%;
      padding: 16px;
      border: none;
      background: #4CAF50;
      color: white;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
      border-radius: 0 0 16px 16px;
    `;
    button.textContent = buttonText;

    // Hover effect
    button.addEventListener('mouseenter', () => {
      button.style.background = '#45a049';
    });
    button.addEventListener('mouseleave', () => {
      button.style.background = '#4CAF50';
    });

    // Click handler
    button.addEventListener('click', () => {
      this.hide();
    });

    // Build alert
    alertBox.appendChild(messageEl);
    alertBox.appendChild(button);
    overlay.appendChild(alertBox);

    // Add animations
    if (!document.getElementById('game-alert-animations')) {
      const style = document.createElement('style');
      style.id = 'game-alert-animations';
      style.textContent = `
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scaleIn {
          from {
            transform: scale(0.9);
            opacity: 0;
          }
          to {
            transform: scale(1);
            opacity: 1;
          }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(overlay);
    this.currentAlert = overlay;

    // Auto-focus button for keyboard accessibility
    setTimeout(() => button.focus(), 100);

    // Allow Enter/Escape to close
    const keyHandler = (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        this.hide();
        document.removeEventListener('keydown', keyHandler);
      }
    };
    document.addEventListener('keydown', keyHandler);
  }

  /**
   * Hide the current alert
   */
  hide() {
    if (this.currentAlert) {
      this.currentAlert.style.opacity = '0';
      setTimeout(() => {
        if (this.currentAlert && this.currentAlert.parentNode) {
          this.currentAlert.parentNode.removeChild(this.currentAlert);
        }
        this.currentAlert = null;
      }, 150);
    }
  }
}

export const gameAlert = new GameAlert();
