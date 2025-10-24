/**
 * playHoleModal.js
 * Handles the Play Hole selection modal with tabs for Official/Community/Your Holes
 */

import { courseManager } from './courseManager.js';

// DOM elements
const modal = document.getElementById('play-hole-modal');
const closeBtn = document.getElementById('close-play-hole-modal');
const tabButtons = {
    official: document.getElementById('tab-official'),
    community: document.getElementById('tab-community'),
    yours: document.getElementById('tab-yours')
};
const tabContents = {
    official: document.getElementById('tab-content-official'),
    community: document.getElementById('tab-content-community'),
    yours: document.getElementById('tab-content-yours')
};
const officialHolesLoading = document.getElementById('official-holes-loading');
const officialHolesList = document.getElementById('official-holes-list');
const officialHolesEmpty = document.getElementById('official-holes-empty');
const yourHolesLoading = document.getElementById('your-holes-loading');
const yourHolesList = document.getElementById('your-holes-list');
const yourHolesEmpty = document.getElementById('your-holes-empty');

let currentTab = 'official';
let onHoleSelectedCallback = null;

/**
 * Show the modal
 * @param {Function} callback - Called when a hole is selected with (holeData)
 */
export function showModal(callback) {
    onHoleSelectedCallback = callback;
    modal.style.display = 'flex';

    // Load holes for the current tab
    if (currentTab === 'official') {
        loadOfficialHoles();
    } else if (currentTab === 'yours') {
        loadUserHoles();
    }
}

/**
 * Hide the modal
 */
export function hideModal() {
    modal.style.display = 'none';
}

/**
 * Switch between tabs
 */
function switchTab(tabName) {
    currentTab = tabName;

    // Update tab buttons
    Object.keys(tabButtons).forEach(key => {
        if (key === tabName) {
            tabButtons[key].classList.add('active');
            tabButtons[key].style.borderBottomColor = '#4CAF50';
            tabButtons[key].style.fontWeight = 'bold';
            tabButtons[key].style.color = '#4CAF50';
        } else {
            tabButtons[key].classList.remove('active');
            tabButtons[key].style.borderBottomColor = 'transparent';
            tabButtons[key].style.fontWeight = 'normal';
            tabButtons[key].style.color = '#666';
        }
    });

    // Update tab content
    Object.keys(tabContents).forEach(key => {
        tabContents[key].style.display = (key === tabName) ? 'block' : 'none';
    });

    // Load data for tabs
    if (tabName === 'official') {
        loadOfficialHoles();
    } else if (tabName === 'yours') {
        loadUserHoles();
    }
}

/**
 * Load official holes from the server
 */
async function loadOfficialHoles() {
    // Show loading state
    officialHolesLoading.style.display = 'block';
    officialHolesList.style.display = 'none';
    officialHolesEmpty.style.display = 'none';

    try {
        const holes = await courseManager.listOfficialHoles();

        if (holes && holes.length > 0) {
            // Display holes
            officialHolesList.innerHTML = '';
            holes.forEach(hole => {
                const holeItem = createOfficialHoleListItem(hole);
                officialHolesList.appendChild(holeItem);
            });
            officialHolesLoading.style.display = 'none';
            officialHolesList.style.display = 'block';
        } else {
            // No holes found
            officialHolesLoading.style.display = 'none';
            officialHolesEmpty.style.display = 'block';
        }
    } catch (error) {
        console.error('Error loading official holes:', error);
        officialHolesLoading.style.display = 'none';
        officialHolesList.innerHTML = '<p style="color: #f44336; text-align: center; padding: 20px;">Error loading holes. Please try again.</p>';
        officialHolesList.style.display = 'block';
    }
}

/**
 * Load user's saved holes from the cloud
 */
async function loadUserHoles() {
    // Show loading state
    yourHolesLoading.style.display = 'block';
    yourHolesList.style.display = 'none';
    yourHolesEmpty.style.display = 'none';

    try {
        const holes = await courseManager.listHoles();

        if (holes && holes.length > 0) {
            // Display holes
            yourHolesList.innerHTML = '';
            holes.forEach(hole => {
                const holeItem = createHoleListItem(hole);
                yourHolesList.appendChild(holeItem);
            });
            yourHolesLoading.style.display = 'none';
            yourHolesList.style.display = 'block';
        } else {
            // No holes found
            yourHolesLoading.style.display = 'none';
            yourHolesEmpty.style.display = 'block';
        }
    } catch (error) {
        console.error('Error loading user holes:', error);
        yourHolesLoading.style.display = 'none';
        yourHolesList.innerHTML = '<p style="color: #f44336; text-align: center; padding: 20px;">Error loading holes. Please try again.</p>';
        yourHolesList.style.display = 'block';
    }
}

/**
 * Create a list item for an official hole
 */
function createOfficialHoleListItem(hole) {
    const div = document.createElement('div');
    div.style.cssText = 'background: #f5f5f5; border: 2px solid #e0e0e0; border-radius: 8px; padding: 15px; margin-bottom: 12px; cursor: pointer; transition: all 0.2s;';

    // Add hover effect
    div.addEventListener('mouseenter', () => {
        div.style.background = '#e8f5e9';
        div.style.borderColor = '#4CAF50';
    });
    div.addEventListener('mouseleave', () => {
        div.style.background = '#f5f5f5';
        div.style.borderColor = '#e0e0e0';
    });

    // Hole info
    const name = document.createElement('div');
    name.style.cssText = 'font-weight: bold; font-size: 1.1em; margin-bottom: 5px; color: #333;';
    name.textContent = hole.name || 'Unnamed Hole';

    const details = document.createElement('div');
    details.style.cssText = 'font-size: 0.9em; color: #666; margin-bottom: 3px;';
    const distance = hole.lengthMeters ? `${Math.round(hole.lengthMeters)}m` : 'N/A';
    details.textContent = `Par ${hole.par || 'N/A'} • ${distance}`;

    const creator = document.createElement('div');
    creator.style.cssText = 'font-size: 0.8em; color: #999;';
    creator.textContent = `By ${hole.createdBy || 'Unknown'}`;

    div.appendChild(name);
    div.appendChild(details);
    div.appendChild(creator);

    // Click handler
    div.addEventListener('click', async () => {
        if (onHoleSelectedCallback) {
            try {
                // Load the full hole data
                const fullHole = await courseManager.loadOfficialHole(hole.holeId);
                // Store hole data in localStorage for playHole mode to pick up
                localStorage.setItem('previewHoleData', JSON.stringify(fullHole.holeData));
                onHoleSelectedCallback(fullHole.holeData);
                hideModal();
            } catch (error) {
                console.error('Error loading official hole:', error);
                alert(`Error loading hole: ${error.message}`);
            }
        }
    });

    return div;
}

/**
 * Create a list item for a hole
 */
function createHoleListItem(hole) {
    const div = document.createElement('div');
    div.style.cssText = 'background: #f5f5f5; border: 2px solid #e0e0e0; border-radius: 8px; padding: 15px; margin-bottom: 12px; cursor: pointer; transition: all 0.2s;';

    // Add hover effect
    div.addEventListener('mouseenter', () => {
        div.style.background = '#e8f5e9';
        div.style.borderColor = '#4CAF50';
    });
    div.addEventListener('mouseleave', () => {
        div.style.background = '#f5f5f5';
        div.style.borderColor = '#e0e0e0';
    });

    // Hole info
    const name = document.createElement('div');
    name.style.cssText = 'font-weight: bold; font-size: 1.1em; margin-bottom: 5px; color: #333;';
    name.textContent = hole.name || 'Unnamed Hole';

    const details = document.createElement('div');
    details.style.cssText = 'font-size: 0.9em; color: #666; margin-bottom: 3px;';
    const distance = hole.lengthMeters ? `${Math.round(hole.lengthMeters)}m` : 'N/A';
    details.textContent = `Par ${hole.par || 'N/A'} • ${distance}`;

    const updated = document.createElement('div');
    updated.style.cssText = 'font-size: 0.8em; color: #999;';
    updated.textContent = `Updated: ${new Date(hole.updatedAt).toLocaleDateString()}`;

    div.appendChild(name);
    div.appendChild(details);
    div.appendChild(updated);

    // Click handler
    div.addEventListener('click', async () => {
        if (onHoleSelectedCallback) {
            try {
                // Load the full hole data (API returns metadata, need to load full data)
                const fullHole = await courseManager.loadHole(hole.holeId);
                // Store hole data in localStorage for playHole mode to pick up
                localStorage.setItem('previewHoleData', JSON.stringify(fullHole.holeData));
                onHoleSelectedCallback(fullHole.holeData);
                hideModal();
            } catch (error) {
                console.error('Error loading hole:', error);
                alert(`Error loading hole: ${error.message}`);
            }
        }
    });

    return div;
}

// Event listeners
closeBtn.addEventListener('click', hideModal);

// Tab click handlers
tabButtons.official.addEventListener('click', () => switchTab('official'));
tabButtons.community.addEventListener('click', () => switchTab('community'));
tabButtons.yours.addEventListener('click', () => switchTab('yours'));

// Click outside to close
modal.addEventListener('click', (e) => {
    if (e.target === modal) {
        hideModal();
    }
});
