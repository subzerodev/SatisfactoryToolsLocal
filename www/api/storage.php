<?php
header('Content-Type: application/json');

// Get key from request
$key = isset($_GET['key']) ? $_GET['key'] : '';
if (empty($key)) {
  http_response_code(400);
  echo json_encode(['error' => 'Storage key is required']);
  exit;
}

// Define storage location - using Docker volume mount for persistence
$dataDir = '/mnt/shared/data';
if (!file_exists($dataDir)) {
  if (!mkdir($dataDir, 0777, true)) {
    error_log("Failed to create directory: $dataDir");
    http_response_code(500);
    echo json_encode(['error' => 'Failed to create storage directory']);
    exit;
  }
}

// Debug log directory creation
error_log("Using storage directory: $dataDir");

// Debug log
error_log("Storage request: " . $_SERVER['REQUEST_METHOD'] . " for key: $key");

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
  $filePath = $dataDir . '/' . $key . '.json';
  if (file_exists($filePath)) {
    $content = file_get_contents($filePath);
    error_log("File found, content length: " . strlen($content));
    echo $content;
  } else {
    error_log("File not found: $filePath");
    echo 'null';
  }
} elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $requestBody = file_get_contents('php://input');
  $filePath = $dataDir . '/' . $key . '.json';
  
  if (file_put_contents($filePath, $requestBody) === false) {
    error_log("Failed to write to file: $filePath");
    http_response_code(500);
    echo json_encode(['error' => 'Failed to save data']);
    exit;
  } else {
    error_log("Successfully saved data to: $filePath");
    echo json_encode(['success' => true]);
  }
} elseif ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
  $filePath = $dataDir . '/' . $key . '.json';
  if (file_exists($filePath)) {
    if (!unlink($filePath)) {
      error_log("Failed to delete file: $filePath");
      http_response_code(500);
      echo json_encode(['error' => 'Failed to delete data']);
      exit;
    }
  }
  echo json_encode(['success' => true]);
}
?>
