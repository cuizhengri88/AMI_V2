# User Management System Setup Guide

## Overview
Complete user management system with auto-increment user IDs, database integration, and CRUD operations.

## Files Created

### 1. Database Schema
**File:** `src-tauri/sql/user_management.sql`
- Table: `user_management` with auto-increment `user_id` (SERIAL PRIMARY KEY)
- Columns: user_id, name, email, phone, address, remarks, created_at, updated_at
- Email is UNIQUE constraint

### 2. Seed Data Script
**File:** `src-tauri/src/bin/user_seed.rs`
- Creates user_management table
- Inserts 4 sample users:
  - 김철수 (chulsoo@example.com)
  - 이영희 (younghee@example.com)
  - 박민준 (minjun@example.com)
  - 최지우 (jiwoo@example.com)

**To run the seed script:**
```bash
cd src-tauri
cargo run --bin user_seed
```

### 3. Tauri Backend Commands
**File:** `src-tauri/src/main.rs`

Added 3 new commands:
- `get_user_management_data()` - Fetch all users
- `upsert_user_management()` - Create/update user
- `delete_user_management()` - Delete user

All commands handle:
- Auto table creation if not exists
- Input validation
- Error handling with Korean messages

### 4. Frontend Integration Ready
**File:** `src/pages/UserManagement/UserManagementPage.tsx`
- Already has UI structure with table display
- Ready to integrate with Tauri commands
- Supports add/edit/delete operations

## Database Connection
The system uses the same database connection pattern as other modules:
- Host: localhost
- Port: 5432
- Database: ami_v2
- Schema: czr_ami
- User: postgres
- Password: postgres

## Implementation Steps

1. **Ensure PostgreSQL is running** with ami_v2 database

2. **Run the seed script** to create table and insert sample data:
   ```bash
   cd src-tauri
   cargo run --bin user_seed
   ```

3. **Build and run the Tauri app** to use the user management system

## Features

✅ Auto-increment user ID (SERIAL PRIMARY KEY)
✅ Sample data with 4 users
✅ CRUD operations via Tauri commands
✅ Email uniqueness constraint
✅ Timestamps (created_at, updated_at)
✅ Error handling with Korean messages
✅ Input validation (name, email required)

## Next Steps

To fully integrate with the UI, update `UserManagementPage.tsx` to:
1. Call `get_user_management_data` on component mount
2. Call `upsert_user_management` on save
3. Call `delete_user_management` on delete
4. Display user_id instead of hardcoded IDs
