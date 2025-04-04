<?php

// Get the requested URI path
$uri = urldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH));
$docRoot = __DIR__;

// Define the main PHP file that loads the SPA
$spaEntryFile = $docRoot . '/index.php';

// Define the full path to the requested resource on the filesystem
$requestedFile = $docRoot . $uri;

// --- Routing Logic ---

// 1. Check for API endpoints first
if (strpos($uri, '/api/') === 0) {
    $apiFile = $docRoot . $uri;
    if (file_exists($apiFile) && is_file($apiFile)) {
        // Include API file instead of returning false to ensure proper execution
        require_once $apiFile;
        exit;
    }
}

// 2. If the request is for an existing file (css, js, png, etc.)
//    and it's not a directory, let the built-in server handle it.
if ($uri !== '/' && file_exists($requestedFile) && is_file($requestedFile)) {
    // Return false tells PHP's built-in server to serve the file directly.
    return false;
}

// 2. For all other requests (including '/' or non-existent files/paths like '/1.0/'),
//    serve the main index.php file to bootstrap the SPA.
//    Make sure the main entry file actually exists.
if (file_exists($spaEntryFile)) {
    // Include the main application file.
    require_once $spaEntryFile;
} else {
    // Basic error handling if index.php is missing
    http_response_code(500);
    error_log("Error: Main application file not found at: " . $spaEntryFile);
    echo "Internal Server Error: Main application file missing.";
}

// Explicitly exit after handling the request via include/require
exit;
?>
