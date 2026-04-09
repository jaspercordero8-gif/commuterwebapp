<?php
// save_favourite.php — Save a route to a user's favourites
require_once 'db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo json_encode(['error' => 'POST required']);
    exit;
}

$data = json_decode(file_get_contents('php://input'), true);

$user_id        = (int) ($data['user_id']        ?? 0);
$start_location = trim($data['start_location']   ?? '');
$destination    = trim($data['destination']       ?? '');
$departure_time = $data['departure_time']         ?? null;

if (!$user_id || !$start_location || !$destination) {
    echo json_encode(['error' => 'user_id, start_location and destination are required']);
    exit;
}

$db = getDB();

// Verify user exists
$stmt = $db->prepare('SELECT user_id FROM users WHERE user_id = ?');
$stmt->execute([$user_id]);
if (!$stmt->fetch()) {
    echo json_encode(['error' => 'User not found']);
    exit;
}

// Check if this exact route is already saved by this user
// (join routes + users_favourite to check)
$stmt = $db->prepare('
    SELECT uf.favourite_id 
    FROM users_favourite uf
    JOIN routes r ON uf.route_id = r.route_id
    WHERE uf.user_id = ? 
      AND r.start_location = ? 
      AND r.destination = ?
');
$stmt->execute([$user_id, $start_location, $destination]);
if ($stmt->fetch()) {
    echo json_encode(['error' => 'You have already saved this route']);
    exit;
}

// Insert into routes table
$stmt = $db->prepare('INSERT INTO routes (start_location, destination, departure_time) VALUES (?, ?, ?)');
$stmt->execute([$start_location, $destination, $departure_time]);
$route_id = (int) $db->lastInsertId();

// Link route to user in users_favourite
$stmt = $db->prepare('INSERT INTO users_favourite (user_id, route_id) VALUES (?, ?)');
$stmt->execute([$user_id, $route_id]);
$favourite_id = (int) $db->lastInsertId();

echo json_encode([
    'success'        => true,
    'message'        => 'Route saved to favourites',
    'favourite_id'   => $favourite_id,
    'route_id'       => $route_id,
    'start_location' => $start_location,
    'destination'    => $destination,
    'saved_at'       => date('Y-m-d H:i:s')
]);