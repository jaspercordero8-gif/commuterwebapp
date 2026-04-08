-- Create database
CREATE DATABASE IF NOT EXISTS journey_planner;
USE journey_planner;

-- =========================
-- USERS TABLE
-- =========================
CREATE TABLE users (
    user_id INT NOT NULL AUTO_INCREMENT,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id)
);

-- =========================
-- ROUTES TABLE
-- =========================
CREATE TABLE routes (
    route_id INT NOT NULL AUTO_INCREMENT,
    start_location VARCHAR(255) NOT NULL,
    destination VARCHAR(255) NOT NULL,
    departure_time TIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (route_id)
);

-- =========================
-- USERS_FAVOURITE TABLE
-- =========================
CREATE TABLE users_favourite (
    favourite_id INT NOT NULL AUTO_INCREMENT,
    user_id INT NOT NULL,
    route_id INT NOT NULL,
    saved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (favourite_id),
    CONSTRAINT fk_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_route
        FOREIGN KEY (route_id)
        REFERENCES routes(route_id)
        ON DELETE CASCADE,
    CONSTRAINT unique_user_route
        UNIQUE (user_id, route_id)
);