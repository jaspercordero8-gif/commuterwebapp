<?php
// get_favourites.php — Fetch all saved routes for a user
require_once 'db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    echo json_encode(['error' => 'GET required']);
    exit;
}

$user_id = (int) ($_GET['user_id'] ?? 0);

if (!$user_id) {
    echo json_encode(['error' => 'user_id is required']);
    exit;
}

$db = getDB();

$stmt = $db->prepare('
    SELECT 
        uf.favourite_id,
        r.route_id,
        r.start_location,
        r.destination,
        r.departure_time,
        uf.saved_at
    FROM users_favourite uf
    JOIN routes r ON uf.route_id = r.route_id
    WHERE uf.user_id = ?
    ORDER BY uf.saved_at DESC
');
$stmt->execute([$user_id]);
$favourites = $stmt->fetchAll();

echo json_encode([
    'success'    => true,
    'favourites' => $favourites
]);