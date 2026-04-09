<?php

require_once 'db.php';

// ── Method guard ────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo json_encode(['error' => 'POST required']);
    exit;
}

// ── Parse input ─────────────────────────────────────────────────────────────
$data = json_decode(file_get_contents('php://input'), true);

$user_id      = (int) ($data['user_id']      ?? 0);
$favourite_id = (int) ($data['favourite_id'] ?? 0);

if (!$user_id || !$favourite_id) {
    echo json_encode(['error' => 'user_id and favourite_id are required']);
    exit;
}

// ── Database ─────────────────────────────────────────────────────────────────
$db = getDB();

// Fetch the linked route_id (also confirms ownership)
$stmt = $db->prepare('SELECT route_id FROM users_favourite WHERE favourite_id = ? AND user_id = ?');
$stmt->execute([$favourite_id, $user_id]);
$row = $stmt->fetch();

if (!$row) {
    echo json_encode(['error' => 'Favourite not found or not yours']);
    exit;
}

$route_id = (int) $row['route_id'];

// Delete from users_favourite first (child of foreign key)
$stmt = $db->prepare('DELETE FROM users_favourite WHERE favourite_id = ? AND user_id = ?');
$stmt->execute([$favourite_id, $user_id]);

// Delete the orphaned route row
$stmt = $db->prepare('DELETE FROM routes WHERE route_id = ?');
$stmt->execute([$route_id]);

// ── Response ─────────────────────────────────────────────────────────────────
echo json_encode([
    'success' => true,
    'message' => 'Route deleted',
]);
