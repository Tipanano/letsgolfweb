/**
 * Toast Notification System
 * Non-blocking notifications that auto-dismiss
 */

class ToastManager {
  constructor() {
    this.container = null;
    this.init();
  }

  init() {
    // Create toast container if it doesn't exist
    if (!document.getElementById('toast-container')) {
      this.container = document.createElement('div');
      this.container.id = 'toast-container';
      this.container.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 10000;
        display: flex;
        flex-direction: column;
        gap: 10px;
        pointer-events: none;
      `;
      document.body.appendChild(this.container);
    } else {
      this.container = document.getElementById('toast-container');
    }
  }

  /**
   * Show a toast notification
   * @param {string} message - The message to display
   * @param {string} type - 'success', 'error', 'info', 'warning'
   * @param {number} duration - Duration in ms (default: 3000)
   */
  show(message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = 'toast';

    // Icon based on type
    const icons = {
      success: '✓',
      error: '✕',
      info: 'ℹ',
      warning: '⚠'
    };

    // Colors based on type
    const colors = {
      success: { bg: '#4CAF50', text: '#fff' },
      error: { bg: '#f44336', text: '#fff' },
      info: { bg: '#2196F3', text: '#fff' },
      warning: { bg: '#FF9800', text: '#fff' }
    };

    const color = colors[type] || colors.info;
    const icon = icons[type] || icons.info;

    toast.style.cssText = `
      background: ${color.bg};
      color: ${color.text};
      padding: 12px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 250px;
      max-width: 400px;
      pointer-events: auto;
      cursor: pointer;
      font-size: 14px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      animation: slideIn 0.3s ease-out;
      transition: opacity 0.3s ease-out, transform 0.3s ease-out;
    `;

    toast.innerHTML = `
      <span style="font-size: 18px; font-weight: bold;">${icon}</span>
      <span style="flex: 1;">${message}</span>
    `;

    // Click to dismiss
    toast.addEventListener('click', () => {
      this.dismiss(toast);
    });

    this.container.appendChild(toast);

    // Auto dismiss
    setTimeout(() => {
      this.dismiss(toast);
    }, duration);

    // Add animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideIn {
        from {
          transform: translateX(400px);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
    `;
    if (!document.getElementById('toast-animations')) {
      style.id = 'toast-animations';
      document.head.appendChild(style);
    }
  }

  dismiss(toast) {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(400px)';
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }

  // Convenience methods
  success(message, duration) {
    this.show(message, 'success', duration);
  }

  error(message, duration) {
    this.show(message, 'error', duration);
  }

  info(message, duration) {
    this.show(message, 'info', duration);
  }

  warning(message, duration) {
    this.show(message, 'warning', duration);
  }
}

export const toast = new ToastManager();
