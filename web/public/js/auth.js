// auth.js — shared auth utilities for Smash Bracket

const API_BASE = 'https://smash-bracket-api.onrender.com';

// ── Token management ──────────────────────────────
function getToken() {
  return localStorage.getItem('authToken');
}

function setToken(token) {
  localStorage.setItem('authToken', token);
}

function getUsername() {
  return localStorage.getItem('username');
}

function setUsername(username) {
  localStorage.setItem('username', username);
}

function clearToken() {
  localStorage.removeItem('authToken');
  localStorage.removeItem('username');
}

function isLoggedIn() {
  return !!getToken();
}

// Redirect to login if not authenticated
function requireAuth() {
  if (!isLoggedIn()) {
    localStorage.setItem('loginReturnUrl', window.location.href);
    window.location.href = '/login';
  }
}

function logout() {
  clearToken();
  window.location.href = '/login';
}
