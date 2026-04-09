<?php


require_once 'db.php';

// ── Method guard ────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    echo json_encode(['error' => 'GET required']);
    exit;
}

// ── Parse input ─────────────────────────────────────────────────────────────
$user_id = (int) ($_GET['user_id'] ?? 0);

if (!$user_id) {
    echo json_encode(['error' => 'user_id is required']);
    exit;
}

// ── Query ────────────────────────────────────────────────────────────────────
$db   = getDB();
$stmt = $db->prepare('
    SELECT
        uf.favourite_id,
        r.route_id,
        r.start_location,
        r.destination,
        r.departure_time,
        uf.saved_at
    FROM   users_favourite uf
    JOIN   routes r ON uf.route_id = r.route_id
    WHERE  uf.user_id = ?
    ORDER  BY uf.saved_at DESC
');
$stmt->execute([$user_id]);
$favourites = $stmt->fetchAll();

// ── Response ─────────────────────────────────────────────────────────────────
echo json_encode([
    'success'    => true,
    'favourites' => $favourites,
]);
