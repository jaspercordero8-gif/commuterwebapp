<?php

require_once 'db.php';

// ── Method guard ────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo json_encode(['error' => 'POST required']);
    exit;
}

// ── Parse input ─────────────────────────────────────────────────────────────
$data = json_decode(file_get_contents('php://input'), true);

$first_name = trim($data['first_name'] ?? '');
$last_name  = trim($data['last_name']  ?? '');
$email      = trim($data['email']      ?? '');
$password   = $data['password']        ?? '';

// ── Validation ───────────────────────────────────────────────────────────────
if (!$first_name || !$last_name || !$email || !$password) {
    echo json_encode(['error' => 'All fields are required']);
    exit;
}

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    echo json_encode(['error' => 'Invalid email address']);
    exit;
}

if (strlen($password) < 6) {
    echo json_encode(['error' => 'Password must be at least 6 characters']);
    exit;
}

// ── Database ─────────────────────────────────────────────────────────────────
$db = getDB();

// Duplicate-email check
$stmt = $db->prepare('SELECT user_id FROM users WHERE email = ?');
$stmt->execute([$email]);
if ($stmt->fetch()) {
    echo json_encode(['error' => 'An account with this email already exists']);
    exit;
}

// Insert new user with hashed password
$hash = password_hash($password, PASSWORD_BCRYPT);
$stmt = $db->prepare('INSERT INTO users (first_name, last_name, email, password_hash) VALUES (?, ?, ?, ?)');
$stmt->execute([$first_name, $last_name, $email, $hash]);

// ── Response ─────────────────────────────────────────────────────────────────
echo json_encode([
    'success'    => true,
    'message'    => 'Account created successfully',
    'user_id'    => (int) $db->lastInsertId(),
    'first_name' => $first_name,
    'last_name'  => $last_name,
    'email'      => $email,
]);