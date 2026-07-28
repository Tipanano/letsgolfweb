/**
 * playHoleModal.js
 * Handles the Play Hole selection modal with tabs for Official/Community/Your Holes
 */

import { courseManager } from './courseManager.js';
import { BUNDLED_COURSES, loadCourse, courseStats } from './courseLibrary.js';

// DOM elements
const modal = document.getElementById('play-hole-modal');
const closeBtn = document.getElementById('close-play-hole-modal');
const tabButtons = {
    courses: document.getElementById('tab-courses'),
    official: document.getElementById('tab-official'),
    community: document.getElementById('tab-community'),
    yours: document.getElementById('tab-yours')
};
const tabContents = {
    courses: document.getElementById('tab-content-courses'),
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

let currentTab = 'courses';
let onHoleSelectedCallback = null;
let onRoundSelectedCallback = null;

/**
 * Show the modal
 * @param {Function} callback - Called when a hole is selected with (holeData)
 */
export function showModal(callback, roundCallback = null) {
    onHoleSelectedCallback = callback;
    onRoundSelectedCallback = roundCallback;
    modal.style.display = 'flex';
    switchTab(currentTab); // Styles the tabs and loads the current tab's data
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
    } else if (tabName === 'courses') {
        loadCourses();
    }
}

// Bundled courses come from the shared courseLibrary (this tab picks single holes)

async function loadCourses() {
    const list = document.getElementById('courses-list');
    if (!list) return;
    list.innerHTML = '<p style="color:#666; text-align:center; padding:30px;">Loading courses…</p>';

    const cards = [];
    for (const entry of BUNDLED_COURSES) {
        try {
            cards.push(createCourseCard(await loadCourse(entry.file)));
        } catch (e) {
            console.error('Failed to load course', entry.file, e);
        }
    }

    list.innerHTML = '';
    if (cards.length === 0) {
        list.innerHTML = '<p style="color:#666; text-align:center; padding:30px;">No courses available.</p>';
        return;
    }
    cards.forEach(c => list.appendChild(c));
}

function createCourseCard(course) {
    const card = document.createElement('div');
    card.style.cssText = 'border:1px solid #e0e0e0; border-radius:8px; padding:14px 16px; margin-bottom:12px; background:#fafafa;';

    const { totalLen, stars } = courseStats(course);

    const head = document.createElement('div');
    head.style.cssText = 'display:flex; justify-content:space-between; align-items:baseline; margin-bottom:6px;';
    head.innerHTML = `<strong style="font-size:1.05em; color:#2e7d32;">${course.name}</strong>` +
        `<span style="color:#666; font-size:0.85em;">Par ${course.par} · ${(totalLen / 1000).toFixed(1)}km · ` +
        `<span title="Difficulty (length + bunkering)" style="color:#e6a817;">${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}</span></span>`;
    card.appendChild(head);

    // (Full rounds start from the dedicated Play Course modal)

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid; grid-template-columns:repeat(6, 1fr); gap:6px;';
    course.holes.forEach((hole, i) => {
        const btn = document.createElement('button');
        btn.style.cssText = 'padding:8px 4px; border:1px solid #c8e6c9; border-radius:6px; background:white; cursor:pointer; font-size:0.82em; line-height:1.3;';
        btn.innerHTML = `<b>${i + 1}</b><br><span style="color:#888;">Par ${hole.par} · ${hole.lengthMeters}m</span>`;
        btn.addEventListener('mouseenter', () => { btn.style.background = '#e8f5e9'; });
        btn.addEventListener('mouseleave', () => { btn.style.background = 'white'; });
        btn.addEventListener('click', () => {
            localStorage.setItem('previewHoleData', JSON.stringify(hole));
            hideModal();
            if (onHoleSelectedCallback) onHoleSelectedCallback(hole);
        });
        grid.appendChild(btn);
    });
    card.appendChild(grid);

    if (course.attribution) {
        const attr = document.createElement('div');
        attr.style.cssText = 'margin-top:8px; font-size:0.72em; color:#999;';
        attr.textContent = course.attribution;
        card.appendChild(attr);
    }
    return card;
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
tabButtons.courses.addEventListener('click', () => switchTab('courses'));
tabButtons.official.addEventListener('click', () => switchTab('official'));
tabButtons.community.addEventListener('click', () => switchTab('community'));
tabButtons.yours.addEventListener('click', () => switchTab('yours'));

// Click outside to close
modal.addEventListener('click', (e) => {
    if (e.target === modal) {
        hideModal();
    }
});
