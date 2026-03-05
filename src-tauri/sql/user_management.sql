-- User Management Table
CREATE TABLE IF NOT EXISTS czr_ami.user_management (
  user_id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  phone VARCHAR(20),
  address VARCHAR(255),
  remarks TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Get all users
-- SELECT * FROM czr_ami.user_management ORDER BY user_id DESC;

-- Get user by ID
-- SELECT * FROM czr_ami.user_management WHERE user_id = $1;

-- Insert new user
-- INSERT INTO czr_ami.user_management (name, email, phone, address, remarks) 
-- VALUES ($1, $2, $3, $4, $5) RETURNING *;

-- Update user
-- UPDATE czr_ami.user_management SET name = $1, email = $2, phone = $3, address = $4, remarks = $5, updated_at = CURRENT_TIMESTAMP 
-- WHERE user_id = $6 RETURNING *;

-- Delete user
-- DELETE FROM czr_ami.user_management WHERE user_id = $1;
