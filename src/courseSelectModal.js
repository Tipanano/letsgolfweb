// src/courseSelectModal.js
//
// Dedicated course picker for full rounds: one card per bundled course with
// par, length, difficulty, and hazard stats. Clicking a card starts an
// 18-hole round. (Single-hole play lives in the Play Hole modal.)

import { BUNDLED_COURSES, loadCourse, courseStats } from './courseLibrary.js';

let modalEl = null;
let onSelect = null;
let stylesInjected = false;

function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
        #course-select-modal {
            position: fixed;
            inset: 0;
            z-index: 10001;
            display: none;
            justify-content: center;
            align-items: center;
            background: rgba(8, 16, 11, 0.75);
        }
        #course-select-modal.visible { display: flex; }
        .course-modal-box {
            width: min(680px, 92vw);
            max-height: 82vh;
            overflow-y: auto;
            padding: 26px 28px;
            border-radius: 16px;
            background: linear-gradient(to bottom, #16301f, #12281a);
            border: 1px solid rgba(125, 255, 160, 0.25);
            color: #eaf6ec;
            font-family: 'Open Sans', system-ui, sans-serif;
        }
        .course-modal-box h2 {
            margin: 0 0 4px;
            border: none;
            color: #fff;
            font-size: 1.5em;
        }
        .course-modal-sub {
            margin: 0 0 18px;
            color: rgba(234, 246, 236, 0.6);
            font-size: 0.9em;
        }
        .course-card2 {
            display: block;
            width: 100%;
            text-align: left;
            padding: 16px 18px;
            margin-bottom: 12px;
            border-radius: 12px;
            border: 1px solid rgba(255, 255, 255, 0.14);
            background: rgba(255, 255, 255, 0.05);
            color: #eaf6ec;
            cursor: pointer;
            font-family: inherit;
            transition: background 0.15s ease, border-color 0.15s ease;
        }
        .course-card2:hover {
            background: rgba(125, 255, 160, 0.12);
            border-color: rgba(125, 255, 160, 0.5);
        }
        .course-card2 .cc-head {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            gap: 10px;
        }
        .course-card2 .cc-name { font-weight: 700; font-size: 1.1em; }
        .course-card2 .cc-stars { color: #ffd76a; letter-spacing: 1px; }
        .course-card2 .cc-stats {
            margin-top: 4px;
            font-size: 0.85em;
            color: rgba(234, 246, 236, 0.65);
        }
        .course-card2 .cc-attr {
            margin-top: 6px;
            font-size: 0.68em;
            color: rgba(234, 246, 236, 0.4);
        }
        .course-modal-close {
            width: 100%;
            margin-top: 6px;
            padding: 11px;
            border: 1px solid rgba(255,255,255,0.2);
            border-radius: 8px;
            background: rgba(255,255,255,0.07);
            color: #eaf6ec;
            font-weight: 600;
            cursor: pointer;
        }
    `;
    document.head.appendChild(style);
}

function ensureCreated() {
    if (modalEl) return;
    injectStyles();
    modalEl = document.createElement('div');
    modalEl.id = 'course-select-modal';
    modalEl.innerHTML = `
        <div class="course-modal-box">
            <h2>Play a Course</h2>
            <p class="course-modal-sub">Full 18-hole round · scorecard · real courses from OpenStreetMap</p>
            <div id="course-select-list"></div>
            <button class="course-modal-close">Cancel</button>
        </div>
    `;
    document.body.appendChild(modalEl);
    modalEl.querySelector('.course-modal-close').addEventListener('click', hideCourseSelect);
    modalEl.addEventListener('click', (e) => { if (e.target === modalEl) hideCourseSelect(); });
}

export async function showCourseSelect(onCourseChosen) {
    ensureCreated();
    onSelect = onCourseChosen;
    modalEl.classList.add('visible');

    const list = modalEl.querySelector('#course-select-list');
    list.innerHTML = '<p style="opacity:0.6; text-align:center; padding:20px;">Loading courses…</p>';

    const cards = [];
    for (const entry of BUNDLED_COURSES) {
        try {
            const course = await loadCourse(entry.file);
            const { totalLen, bunkers, water, stars } = courseStats(course);
            const card = document.createElement('button');
            card.className = 'course-card2';
            card.innerHTML = `
                <div class="cc-head">
                    <span class="cc-name">${course.name}</span>
                    <span class="cc-stars">${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}</span>
                </div>
                <div class="cc-stats">Par ${course.par} · ${(totalLen / 1000).toFixed(1)} km · ${course.holes.length} holes · ${bunkers} bunkers${water ? ` · ${water} water` : ''}</div>
                ${course.attribution ? `<div class="cc-attr">${course.attribution}</div>` : ''}
            `;
            card.addEventListener('click', () => {
                hideCourseSelect();
                if (onSelect) onSelect(course);
            });
            cards.push(card);
        } catch (e) {
            console.error('Course load failed:', entry.file, e);
        }
    }

    list.innerHTML = '';
    if (cards.length === 0) {
        list.innerHTML = '<p style="opacity:0.6; text-align:center; padding:20px;">No courses available.</p>';
        return;
    }
    cards.forEach(c => list.appendChild(c));
}

export function hideCourseSelect() {
    if (modalEl) modalEl.classList.remove('visible');
}
