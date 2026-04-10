// auth.js — shared auth utilities for Smash Bracket

const API_BASE = 'https://smash-bracket-api.onrender.com';

// ── Token management ──────────────────────────────
function getToken() {
  return sessionStorage.getItem('authToken');
}

function setToken(token) {
  sessionStorage.setItem('authToken', token);
}

function getUsername() {
  return sessionStorage.getItem('username');
}

function setUsername(username) {
  sessionStorage.setItem('username', username);
}

function clearToken() {
  sessionStorage.removeItem('authToken');
  sessionStorage.removeItem('username');
}

function isLoggedIn() {
  return !!getToken();
}

// Redirect to login if not authenticated
function requireAuth() {
  if (!isLoggedIn()) {
    window.location.href = 'login.html';
  }
}

// Redirect away from login if already authenticated
function redirectIfLoggedIn() {
  if (isLoggedIn()) {
    window.location.href = 'index.html';
  }
}

function logout() {
  clearToken();
  window.location.href = 'login.html';
}
