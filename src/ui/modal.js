/**
 * Modal Alert System
 * Blocking modals that require user interaction
 */

class ModalManager {
  constructor() {
    this.currentModal = null;
  }

  /**
   * Show an alert modal
   * @param {string} message - The message to display
   * @param {string} title - Modal title (optional)
   * @param {string} type - 'info', 'warning', 'error', 'success'
   * @returns {Promise} Resolves when user clicks OK
   */
  alert(message, title = '', type = 'info') {
    return new Promise((resolve) => {
      this.show({
        title,
        message,
        type,
        buttons: [
          {
            text: 'OK',
            primary: true,
            onClick: () => {
              this.hide();
              resolve();
            }
          }
        ]
      });
    });
  }

  /**
   * Show a confirm modal
   * @param {string} message - The message to display
   * @param {string} title - Modal title (optional)
   * @param {string} type - 'info', 'warning', 'error', 'success'
   * @returns {Promise<boolean>} Resolves with true/false based on user choice
   */
  confirm(message, title = '', type = 'warning') {
    return new Promise((resolve) => {
      this.show({
        title,
        message,
        type,
        buttons: [
          {
            text: 'Cancel',
            primary: false,
            onClick: () => {
              this.hide();
              resolve(false);
            }
          },
          {
            text: 'OK',
            primary: true,
            onClick: () => {
              this.hide();
              resolve(true);
            }
          }
        ]
      });
    });
  }

  /**
   * Show a prompt modal with input field
   * @param {string} message - The message to display
   * @param {string} title - Modal title (optional)
   * @param {string} defaultValue - Default input value
   * @param {string} placeholder - Input placeholder
   * @returns {Promise<string|null>} Resolves with input value or null if cancelled
   */
  prompt(message, title = '', defaultValue = '', placeholder = '') {
    return new Promise((resolve) => {
      // Remove existing modal if any
      if (this.currentModal) {
        this.hide();
      }

      const type = 'info';
      const color = '#2196F3';

      // Create overlay
      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        z-index: 9999;
        display: flex;
        justify-content: center;
        align-items: center;
        animation: fadeIn 0.2s ease-out;
      `;

      // Create modal
      const modal = document.createElement('div');
      modal.style.cssText = `
        background: white;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        min-width: 360px;
        max-width: 500px;
        animation: slideUp 0.3s ease-out;
      `;

      // Build modal content
      let modalHTML = `
        <div style="padding: 24px 24px 16px;">
          ${title ? `<h2 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 600; color: #333;">${title}</h2>` : ''}
          <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.5; color: #666;">
            ${message}
          </p>
          <input
            type="text"
            id="prompt-input"
            value="${defaultValue}"
            placeholder="${placeholder}"
            style="
              width: 100%;
              padding: 10px 12px;
              border: 2px solid #ddd;
              border-radius: 6px;
              font-size: 16px;
              box-sizing: border-box;
              outline: none;
              transition: border-color 0.2s;
            "
          />
        </div>
        <div style="padding: 0 24px 24px; display: flex; gap: 12px; justify-content: flex-end;">
          <button id="prompt-cancel" style="
            background: #e0e0e0;
            color: #333;
            border: none;
            padding: 10px 24px;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: opacity 0.2s;
          ">Avbryt</button>
          <button id="prompt-ok" style="
            background: ${color};
            color: white;
            border: none;
            padding: 10px 24px;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: opacity 0.2s;
          ">OK</button>
        </div>
      `;

      modal.innerHTML = modalHTML;

      const inputEl = modal.querySelector('#prompt-input');
      const okBtn = modal.querySelector('#prompt-ok');
      const cancelBtn = modal.querySelector('#prompt-cancel');

      // Focus input with border highlight
      inputEl.addEventListener('focus', () => {
        inputEl.style.borderColor = color;
      });
      inputEl.addEventListener('blur', () => {
        inputEl.style.borderColor = '#ddd';
      });

      // Button hover effects
      [okBtn, cancelBtn].forEach(btn => {
        btn.addEventListener('mouseenter', () => btn.style.opacity = '0.9');
        btn.addEventListener('mouseleave', () => btn.style.opacity = '1');
      });

      // Handle OK
      const handleOk = () => {
        const value = inputEl.value.trim();
        this.hide();
        resolve(value || null);
      };

      // Handle Cancel
      const handleCancel = () => {
        this.hide();
        resolve(null);
      };

      okBtn.addEventListener('click', handleOk);
      cancelBtn.addEventListener('click', handleCancel);

      // Enter key submits
      inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          handleOk();
        } else if (e.key === 'Escape') {
          handleCancel();
        }
      });

      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      this.currentModal = overlay;

      // Focus input after a short delay
      setTimeout(() => {
        inputEl.focus();
        inputEl.select();
      }, 100);
    });
  }

  /**
   * Show a custom modal
   * @param {object} options - { title, message, type, buttons }
   */
  show(options) {
    // Remove existing modal if any
    if (this.currentModal) {
      this.hide();
    }

    const { title, message, type = 'info', buttons = [] } = options;

    // Icon and color based on type
    const icons = {
      success: '✓',
      error: '✕',
      info: 'ℹ',
      warning: '⚠'
    };

    const colors = {
      success: '#4CAF50',
      error: '#f44336',
      info: '#2196F3',
      warning: '#FF9800'
    };

    const icon = icons[type] || icons.info;
    const color = colors[type] || colors.info;

    // Create overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      z-index: 9999;
      display: flex;
      justify-content: center;
      align-items: center;
      animation: fadeIn 0.2s ease-out;
    `;

    // Create modal
    const modal = document.createElement('div');
    modal.style.cssText = `
      background: white;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      min-width: 320px;
      max-width: 500px;
      max-height: 80vh;
      overflow: auto;
      animation: slideUp 0.3s ease-out;
    `;

    // Build modal content
    let modalHTML = '';

    // Icon header
    if (icon) {
      modalHTML += `
        <div style="
          background: ${color};
          color: white;
          padding: 20px;
          border-radius: 12px 12px 0 0;
          text-align: center;
        ">
          <div style="font-size: 48px; margin-bottom: 10px;">${icon}</div>
          ${title ? `<h2 style="margin: 0; font-size: 20px; font-weight: 600;">${title}</h2>` : ''}
        </div>
      `;
    }

    // Message
    modalHTML += `
      <div style="padding: 24px; font-size: 16px; line-height: 1.5; color: #333;">
        ${message}
      </div>
    `;

    // Buttons
    if (buttons.length > 0) {
      modalHTML += '<div style="padding: 0 24px 24px; display: flex; gap: 12px; justify-content: flex-end;">';
      buttons.forEach(btn => {
        const buttonStyle = btn.primary
          ? `background: ${color}; color: white;`
          : 'background: #e0e0e0; color: #333;';

        modalHTML += `
          <button class="modal-btn" data-action="${btn.text}" style="
            ${buttonStyle}
            border: none;
            padding: 10px 24px;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: opacity 0.2s;
          ">${btn.text}</button>
        `;
      });
      modalHTML += '</div>';
    }

    modal.innerHTML = modalHTML;

    // Add event listeners to buttons
    buttons.forEach(btn => {
      const buttonEl = modal.querySelector(`[data-action="${btn.text}"]`);
      if (buttonEl) {
        buttonEl.addEventListener('click', btn.onClick);
        buttonEl.addEventListener('mouseenter', () => {
          buttonEl.style.opacity = '0.9';
        });
        buttonEl.addEventListener('mouseleave', () => {
          buttonEl.style.opacity = '1';
        });
      }
    });

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Add animations
    const style = document.createElement('style');
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes slideUp {
        from {
          transform: translateY(50px);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }
    `;
    if (!document.getElementById('modal-animations')) {
      style.id = 'modal-animations';
      document.head.appendChild(style);
    }

    this.currentModal = overlay;

    // Close on overlay click (optional - can be disabled)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        // Don't auto-close - require button click
        // this.hide();
      }
    });
  }

  /**
   * Hide the current modal
   */
  hide() {
    if (this.currentModal) {
      this.currentModal.style.opacity = '0';
      setTimeout(() => {
        if (this.currentModal && this.currentModal.parentNode) {
          this.currentModal.parentNode.removeChild(this.currentModal);
        }
        this.currentModal = null;
      }, 200);
    }
  }
}

export const modal = new ModalManager();
