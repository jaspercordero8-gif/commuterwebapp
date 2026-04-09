<?php


require_once 'db.php';

// ── Method guard ────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo json_encode(['error' => 'POST required']);
    exit;
}

// ── Parse input ─────────────────────────────────────────────────────────────
$data = json_decode(file_get_contents('php://input'), true);

$email    = trim($data['email']    ?? '');
$password =      $data['password'] ?? '';

if (!$email || !$password) {
    echo json_encode(['error' => 'Email and password are required']);
    exit;
}

// ── Authenticate ─────────────────────────────────────────────────────────────
$db   = getDB();
$stmt = $db->prepare('SELECT user_id, first_name, last_name, email, password_hash FROM users WHERE email = ?');
$stmt->execute([$email]);
$user = $stmt->fetch();

// Use a generic message to avoid leaking whether the email exists
if (!$user || !password_verify($password, $user['password_hash'])) {
    echo json_encode(['error' => 'Incorrect email or password']);
    exit;
}

// ── Response (never expose password_hash) ────────────────────────────────────
echo json_encode([
    'success'    => true,
    'user_id'    => $user['user_id'],
    'first_name' => $user['first_name'],
    'last_name'  => $user['last_name'],
    'email'      => $user['email'],
]);