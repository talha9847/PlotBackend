-- Plotwise comprehensive PostgreSQL schema
-- PostgreSQL 15+ recommended. Run on an EMPTY database with:
-- psql "$DATABASE_URL" -f plotwise_database.sql
-- Store password hashes only. Create the first admin through a secure seed script.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Users, roles, permissions and sessions
CREATE TABLE users (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 full_name VARCHAR(160) NOT NULL,
 email VARCHAR(254) NOT NULL UNIQUE,
 phone VARCHAR(30),
 password_hash TEXT NOT NULL,
 role VARCHAR(30) NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','manager','accountant','sales','viewer')),
 is_active BOOLEAN NOT NULL DEFAULT TRUE,
 email_verified_at TIMESTAMPTZ,
 last_login_at TIMESTAMPTZ,
 password_changed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 deleted_at TIMESTAMPTZ
);
CREATE TABLE roles (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 name VARCHAR(50) NOT NULL UNIQUE,
 description TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE permissions (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 code VARCHAR(100) NOT NULL UNIQUE,
 description TEXT
);
CREATE TABLE role_permissions (
 role_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
 permission_id BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
 PRIMARY KEY(role_id, permission_id)
);
CREATE TABLE user_roles (
 user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 role_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
 assigned_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
 assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(user_id, role_id)
);
CREATE TABLE user_sessions (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 refresh_token_hash TEXT NOT NULL UNIQUE,
 ip_address INET,
 user_agent TEXT,
 expires_at TIMESTAMPTZ NOT NULL,
 revoked_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE password_reset_tokens (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE,
 expires_at TIMESTAMPTZ NOT NULL,
 used_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO roles(name,description) VALUES
 ('admin','Full access to Plotwise'),('manager','Project and operational management'),
 ('accountant','Payments and financial reports'),('sales','Customers and bookings'),('viewer','Read-only access')
ON CONFLICT(name) DO NOTHING;
-- users.role defaults to admin as requested. No real user/password is seeded here.

-- 2. Organization and settings
CREATE TABLE organizations (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 legal_name VARCHAR(200) NOT NULL,
 display_name VARCHAR(160), registration_no VARCHAR(100), tax_id VARCHAR(100),
 email VARCHAR(254), phone VARCHAR(30), website TEXT,
 address_line1 TEXT, address_line2 TEXT, city VARCHAR(100), state VARCHAR(100),
 postal_code VARCHAR(20), country_code CHAR(2) NOT NULL DEFAULT 'IN',
 currency_code CHAR(3) NOT NULL DEFAULT 'INR', timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Kolkata',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE system_settings (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 setting_key VARCHAR(120) NOT NULL UNIQUE,
 setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,
 description TEXT, updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Projects and land inventory
CREATE TABLE projects (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 organization_id BIGINT REFERENCES organizations(id) ON DELETE RESTRICT,
 project_code VARCHAR(60) NOT NULL UNIQUE, name VARCHAR(200) NOT NULL,
 slug VARCHAR(220) UNIQUE, description TEXT,
 project_type VARCHAR(40) NOT NULL DEFAULT 'residential' CHECK(project_type IN ('residential','commercial','industrial','mixed_use','agricultural','other')),
 status VARCHAR(30) NOT NULL DEFAULT 'planning' CHECK(status IN ('planning','active','on_hold','completed','archived')),
 address_line1 TEXT, address_line2 TEXT, city VARCHAR(100), district VARCHAR(100), state VARCHAR(100),
 postal_code VARCHAR(20), country_code CHAR(2) NOT NULL DEFAULT 'IN',
 latitude NUMERIC(10,7) CHECK(latitude IS NULL OR latitude BETWEEN -90 AND 90),
 longitude NUMERIC(10,7) CHECK(longitude IS NULL OR longitude BETWEEN -180 AND 180),
 total_area NUMERIC(16,3) CHECK(total_area IS NULL OR total_area >= 0),
 area_unit VARCHAR(20) NOT NULL DEFAULT 'sq_ft' CHECK(area_unit IN ('sq_ft','sq_m','sq_yd','acre','hectare','guntha','bigha','other')),
 currency_code CHAR(3) NOT NULL DEFAULT 'INR', start_date DATE, target_completion_date DATE, actual_completion_date DATE,
 project_manager_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
 created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ
);
CREATE TABLE land_parcels (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 parcel_code VARCHAR(80) NOT NULL, survey_number VARCHAR(120), title_reference VARCHAR(160), owner_name VARCHAR(200),
 acquisition_date DATE, area NUMERIC(16,3) NOT NULL CHECK(area >= 0), area_unit VARCHAR(20) NOT NULL DEFAULT 'sq_ft',
 address TEXT, legal_status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK(legal_status IN ('pending','verified','disputed','rejected')),
 notes TEXT, created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(project_id,parcel_code)
);
CREATE TABLE project_sections (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 section_code VARCHAR(60) NOT NULL, name VARCHAR(160) NOT NULL, description TEXT,
 display_order INTEGER NOT NULL DEFAULT 0,
 status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK(status IN ('active','on_hold','completed','archived')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(project_id,section_code), UNIQUE(project_id,name)
);
CREATE TABLE plots (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 land_parcel_id BIGINT REFERENCES land_parcels(id) ON DELETE RESTRICT,
 section_id BIGINT REFERENCES project_sections(id) ON DELETE RESTRICT,
 plot_number VARCHAR(80) NOT NULL,
 plot_type VARCHAR(30) NOT NULL DEFAULT 'residential' CHECK(plot_type IN ('residential','commercial','industrial','agricultural','other')),
 area NUMERIC(14,3) NOT NULL CHECK(area >= 0), area_unit VARCHAR(20) NOT NULL DEFAULT 'sq_ft',
 base_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(base_price >= 0),
 price_per_unit NUMERIC(14,2) CHECK(price_per_unit IS NULL OR price_per_unit >= 0),
 facing VARCHAR(40), road_width NUMERIC(8,2),
 status VARCHAR(24) NOT NULL DEFAULT 'available' CHECK(status IN ('available','reserved','booked','sold','blocked','under_development')),
 map_x NUMERIC(12,4), map_y NUMERIC(12,4), map_width NUMERIC(12,4), map_height NUMERIC(12,4), map_rotation NUMERIC(8,3) NOT NULL DEFAULT 0,
 notes TEXT, created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ,
 UNIQUE(project_id,plot_number)
);



CREATE TABLE plot_boundaries (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 plot_id BIGINT NOT NULL REFERENCES plots(id) ON DELETE CASCADE,
 geometry JSONB NOT NULL, coordinate_reference_system VARCHAR(80) NOT NULL DEFAULT 'WGS84',
 version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0), created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(plot_id,version)
);
CREATE TABLE project_features (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 name VARCHAR(120) NOT NULL, description TEXT, icon VARCHAR(80), is_available BOOLEAN NOT NULL DEFAULT TRUE,
 display_order INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(project_id,name)
);
CREATE TABLE project_documents (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 document_type VARCHAR(60) NOT NULL, title VARCHAR(200) NOT NULL, storage_key TEXT NOT NULL,
 file_name VARCHAR(255), mime_type VARCHAR(120), file_size_bytes BIGINT CHECK(file_size_bytes IS NULL OR file_size_bytes >= 0),
 document_number VARCHAR(120), issued_on DATE, expires_on DATE,
 verification_status VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK(verification_status IN ('pending','verified','rejected','expired')),
 uploaded_by BIGINT REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE plot_documents (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 plot_id BIGINT NOT NULL REFERENCES plots(id) ON DELETE CASCADE,
 document_type VARCHAR(60) NOT NULL, title VARCHAR(200) NOT NULL, storage_key TEXT NOT NULL,
 file_name VARCHAR(255), mime_type VARCHAR(120), file_size_bytes BIGINT CHECK(file_size_bytes IS NULL OR file_size_bytes >= 0),
 uploaded_by BIGINT REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE project_settings (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 setting_key VARCHAR(120) NOT NULL, setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,
 updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(project_id,setting_key)
);

-- 4. Customers and KYC documents
CREATE TABLE customers (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(), customer_code VARCHAR(60) UNIQUE,
 first_name VARCHAR(100) NOT NULL, middle_name VARCHAR(100), last_name VARCHAR(100),
 phone VARCHAR(30) NOT NULL, alternate_phone VARCHAR(30), email VARCHAR(254), date_of_birth DATE,
 customer_type VARCHAR(20) NOT NULL DEFAULT 'individual' CHECK(customer_type IN ('individual','company','partnership','trust','other')),
 company_name VARCHAR(200), tax_id VARCHAR(100), address_line1 TEXT, address_line2 TEXT,
 city VARCHAR(100), district VARCHAR(100), state VARCHAR(100), postal_code VARCHAR(20), country_code CHAR(2) NOT NULL DEFAULT 'IN',
 communication_language VARCHAR(20) NOT NULL DEFAULT 'en', marketing_consent BOOLEAN NOT NULL DEFAULT FALSE,
 consent_recorded_at TIMESTAMPTZ, notes TEXT, created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ
);
CREATE TABLE customer_documents (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
 document_type VARCHAR(60) NOT NULL, document_number_encrypted TEXT, storage_key TEXT, file_name VARCHAR(255),
 verification_status VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK(verification_status IN ('pending','verified','rejected','expired')),
 verified_by BIGINT REFERENCES users(id) ON DELETE SET NULL, verified_at TIMESTAMPTZ, expires_on DATE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Bookings, status history, documents and cancellation
CREATE TABLE bookings (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(), booking_number VARCHAR(80) NOT NULL UNIQUE,
 project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 plot_id BIGINT NOT NULL REFERENCES plots(id) ON DELETE RESTRICT,
 customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
 booking_date DATE NOT NULL DEFAULT CURRENT_DATE, reserved_until TIMESTAMPTZ,
 agreed_price NUMERIC(14,2) NOT NULL CHECK(agreed_price >= 0), discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(discount_amount >= 0),
 tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(tax_amount >= 0), total_amount NUMERIC(14,2) NOT NULL CHECK(total_amount >= 0),
 booking_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(booking_amount >= 0),
 status VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','reserved','confirmed','cancelled','completed','refunded')),
 cancellation_reason TEXT, notes TEXT, sales_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
 created_by BIGINT REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK(discount_amount <= agreed_price), CHECK(booking_amount <= total_amount)
);
CREATE UNIQUE INDEX uq_bookings_one_live_booking_per_plot ON bookings(plot_id) WHERE status IN ('pending','reserved','confirmed');
CREATE TABLE booking_status_history (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
 old_status VARCHAR(24), new_status VARCHAR(24) NOT NULL, reason TEXT,
 changed_by BIGINT REFERENCES users(id) ON DELETE SET NULL, changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE booking_documents (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
 document_type VARCHAR(60) NOT NULL, title VARCHAR(200) NOT NULL, storage_key TEXT NOT NULL,
 file_name VARCHAR(255), mime_type VARCHAR(120), signed_at TIMESTAMPTZ,
 uploaded_by BIGINT REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE booking_cancellations (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 booking_id BIGINT NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE RESTRICT,
 requested_by BIGINT REFERENCES users(id) ON DELETE SET NULL, reason TEXT NOT NULL,
 cancellation_fee NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(cancellation_fee >= 0), refund_due NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(refund_due >= 0),
 status VARCHAR(24) NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','approved','rejected','processed')),
 reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL, reviewed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Installment plans, installments and reschedules
CREATE TABLE installment_plans (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(), booking_id BIGINT NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE RESTRICT,
 plan_name VARCHAR(160) NOT NULL, total_amount NUMERIC(14,2) NOT NULL CHECK(total_amount >= 0),
 down_payment NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(down_payment >= 0),
 installment_count INTEGER NOT NULL DEFAULT 1 CHECK(installment_count > 0),
 frequency VARCHAR(24) NOT NULL DEFAULT 'monthly' CHECK(frequency IN ('weekly','monthly','quarterly','half_yearly','yearly','milestone','custom')),
 start_date DATE, status VARCHAR(24) NOT NULL DEFAULT 'active' CHECK(status IN ('draft','active','completed','cancelled','restructured')),
 created_by BIGINT REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK(down_payment <= total_amount)
);
CREATE TABLE installments (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(), plan_id BIGINT NOT NULL REFERENCES installment_plans(id) ON DELETE RESTRICT,
 installment_number INTEGER NOT NULL CHECK(installment_number > 0), description VARCHAR(200), due_date DATE NOT NULL,
 amount_due NUMERIC(14,2) NOT NULL CHECK(amount_due >= 0), late_fee NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(late_fee >= 0),
 waived_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(waived_amount >= 0),
 status VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','partially_paid','paid','overdue','waived','cancelled')),
 paid_at TIMESTAMPTZ, notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(plan_id,installment_number), CHECK(waived_amount <= amount_due + late_fee)
);
CREATE TABLE installment_reschedules (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 installment_id BIGINT NOT NULL REFERENCES installments(id) ON DELETE RESTRICT,
 old_due_date DATE NOT NULL, new_due_date DATE NOT NULL, reason TEXT NOT NULL,
 approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL, created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Payments, allocations, refunds, receipts and adjustments
CREATE TABLE payment_methods (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, code VARCHAR(40) NOT NULL UNIQUE,
 name VARCHAR(80) NOT NULL, is_active BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO payment_methods(code,name) VALUES
 ('cash','Cash'),('upi','UPI'),('bank_transfer','Bank transfer'),('cheque','Cheque'),('card','Card'),('payment_gateway','Payment gateway'),('other','Other')
ON CONFLICT(code) DO NOTHING;
CREATE TABLE payments (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(), payment_number VARCHAR(80) NOT NULL UNIQUE,
 booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
 customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
 payment_method_id BIGINT REFERENCES payment_methods(id) ON DELETE RESTRICT,
 amount NUMERIC(14,2) NOT NULL CHECK(amount > 0), currency_code CHAR(3) NOT NULL DEFAULT 'INR', payment_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 received_by BIGINT REFERENCES users(id) ON DELETE SET NULL, transaction_reference VARCHAR(180), gateway_name VARCHAR(80), gateway_transaction_id VARCHAR(180),
 status VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','failed','cancelled','partially_refunded','refunded')),
 notes TEXT, metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE payment_allocations (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 payment_id BIGINT NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
 installment_id BIGINT NOT NULL REFERENCES installments(id) ON DELETE RESTRICT,
 amount_allocated NUMERIC(14,2) NOT NULL CHECK(amount_allocated > 0),
 allocated_by BIGINT REFERENCES users(id) ON DELETE SET NULL, allocated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(payment_id,installment_id)
);
CREATE TABLE payment_refunds (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(), payment_id BIGINT NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
 refund_number VARCHAR(80) NOT NULL UNIQUE, amount NUMERIC(14,2) NOT NULL CHECK(amount > 0), reason TEXT NOT NULL,
 status VARCHAR(24) NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','approved','processing','completed','failed','rejected')),
 refund_reference VARCHAR(180), requested_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
 approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL, processed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE receipts (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(), receipt_number VARCHAR(80) NOT NULL UNIQUE,
 payment_id BIGINT NOT NULL UNIQUE REFERENCES payments(id) ON DELETE RESTRICT,
 issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), issued_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
 storage_key TEXT, status VARCHAR(20) NOT NULL DEFAULT 'issued' CHECK(status IN ('issued','voided','reissued')), notes TEXT
);
CREATE TABLE payment_adjustments (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
 installment_id BIGINT REFERENCES installments(id) ON DELETE RESTRICT,
 adjustment_type VARCHAR(24) NOT NULL CHECK(adjustment_type IN ('discount','waiver','late_fee','correction','credit','debit')),
 amount NUMERIC(14,2) NOT NULL CHECK(amount > 0), reason TEXT NOT NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','applied','reversed')),
 requested_by BIGINT REFERENCES users(id) ON DELETE SET NULL, approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
 applied_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. WhatsApp, email, SMS and notifications
CREATE TABLE notification_templates (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 code VARCHAR(100) NOT NULL UNIQUE, channel VARCHAR(24) NOT NULL CHECK(channel IN ('whatsapp','email','sms','in_app')),
 language_code VARCHAR(20) NOT NULL DEFAULT 'en', subject VARCHAR(200), body TEXT NOT NULL,
 provider_template_name VARCHAR(160), is_active BOOLEAN NOT NULL DEFAULT TRUE,
 created_by BIGINT REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE notification_preferences (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
 channel VARCHAR(24) NOT NULL CHECK(channel IN ('whatsapp','email','sms','in_app')),
 transactional_enabled BOOLEAN NOT NULL DEFAULT TRUE, marketing_enabled BOOLEAN NOT NULL DEFAULT FALSE,
 consent_source VARCHAR(80), consented_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(customer_id,channel)
);
CREATE TABLE reminder_schedules (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
 name VARCHAR(160) NOT NULL, days_before_due INTEGER NOT NULL DEFAULT 0, days_after_due INTEGER,
 channel VARCHAR(24) NOT NULL DEFAULT 'whatsapp' CHECK(channel IN ('whatsapp','email','sms','in_app')),
 template_id BIGINT REFERENCES notification_templates(id) ON DELETE SET NULL,
 is_active BOOLEAN NOT NULL DEFAULT TRUE, created_by BIGINT REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE notification_logs (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(), customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
 booking_id BIGINT REFERENCES bookings(id) ON DELETE SET NULL, installment_id BIGINT REFERENCES installments(id) ON DELETE SET NULL,
 payment_id BIGINT REFERENCES payments(id) ON DELETE SET NULL, template_id BIGINT REFERENCES notification_templates(id) ON DELETE SET NULL,
 channel VARCHAR(24) NOT NULL CHECK(channel IN ('whatsapp','email','sms','in_app')), destination VARCHAR(254), message_body TEXT,
 provider VARCHAR(80), provider_message_id VARCHAR(200),
 status VARCHAR(24) NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sent','delivered','read','failed','cancelled')),
 scheduled_at TIMESTAMPTZ, sent_at TIMESTAMPTZ, delivered_at TIMESTAMPTZ, read_at TIMESTAMPTZ, failed_at TIMESTAMPTZ,
 error_code VARCHAR(100), error_message TEXT, metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE webhook_events (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 provider VARCHAR(80) NOT NULL, provider_event_id VARCHAR(200) NOT NULL, event_type VARCHAR(160) NOT NULL, payload JSONB NOT NULL,
 signature_valid BOOLEAN, processing_status VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK(processing_status IN ('pending','processing','processed','failed','ignored')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0), received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), processed_at TIMESTAMPTZ,
 last_error TEXT, UNIQUE(provider,provider_event_id)
);

-- 9. Files, activity/audit, idempotency and background jobs
CREATE TABLE file_attachments (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(), storage_provider VARCHAR(60) NOT NULL,
 storage_key TEXT NOT NULL UNIQUE, original_file_name VARCHAR(255) NOT NULL, mime_type VARCHAR(120),
 size_bytes BIGINT CHECK(size_bytes IS NULL OR size_bytes >= 0), checksum_sha256 CHAR(64),
 uploaded_by BIGINT REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE activity_logs (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL, project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
 action VARCHAR(120) NOT NULL, entity_type VARCHAR(100) NOT NULL, entity_id VARCHAR(100), description TEXT,
 metadata JSONB NOT NULL DEFAULT '{}'::jsonb, ip_address INET, user_agent TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE audit_logs (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL, action VARCHAR(120) NOT NULL,
 table_name VARCHAR(120) NOT NULL, record_id VARCHAR(100) NOT NULL, old_values JSONB, new_values JSONB, reason TEXT,
 ip_address INET, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE idempotency_keys (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 key VARCHAR(200) NOT NULL UNIQUE, user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
 request_hash CHAR(64), response_status INTEGER, response_body JSONB, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE background_jobs (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 job_type VARCHAR(120) NOT NULL, payload JSONB NOT NULL DEFAULT '{}'::jsonb,
 status VARCHAR(24) NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed','cancelled')),
 priority INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0), max_attempts INTEGER NOT NULL DEFAULT 5 CHECK(max_attempts > 0),
 run_after TIMESTAMPTZ NOT NULL DEFAULT NOW(), locked_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, last_error TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Indexes for common filters, joins and reports
CREATE INDEX idx_users_role_active ON users(role,is_active) WHERE deleted_at IS NULL;
CREATE INDEX idx_projects_status ON projects(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_projects_city_state ON projects(city,state);
CREATE INDEX idx_land_parcels_project ON land_parcels(project_id);
CREATE INDEX idx_sections_project_order ON project_sections(project_id,display_order);
CREATE INDEX idx_plots_project_status ON plots(project_id,status) WHERE deleted_at IS NULL;
CREATE INDEX idx_plots_section_status ON plots(section_id,status);
CREATE INDEX idx_plots_land_parcel ON plots(land_parcel_id);
CREATE INDEX idx_customers_phone ON customers(phone) WHERE deleted_at IS NULL;
CREATE INDEX idx_customers_email ON customers(email) WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_bookings_customer_date ON bookings(customer_id,booking_date DESC);
CREATE INDEX idx_bookings_project_status ON bookings(project_id,status);
CREATE INDEX idx_bookings_plot_status ON bookings(plot_id,status);
CREATE INDEX idx_installments_due_status ON installments(due_date,status);
CREATE INDEX idx_installments_plan ON installments(plan_id);
CREATE INDEX idx_payments_booking_date ON payments(booking_id,payment_date DESC);
CREATE INDEX idx_payments_customer_date ON payments(customer_id,payment_date DESC);
CREATE INDEX idx_payments_status ON payments(status,payment_date DESC);
CREATE INDEX idx_payment_allocations_installment ON payment_allocations(installment_id);
CREATE INDEX idx_refunds_payment_status ON payment_refunds(payment_id,status);
CREATE INDEX idx_notification_logs_status_schedule ON notification_logs(status,scheduled_at);
CREATE INDEX idx_notification_logs_customer_created ON notification_logs(customer_id,created_at DESC);
CREATE INDEX idx_webhook_events_status_received ON webhook_events(processing_status,received_at);
CREATE INDEX idx_activity_logs_entity ON activity_logs(entity_type,entity_id,created_at DESC);
CREATE INDEX idx_activity_logs_actor ON activity_logs(actor_user_id,created_at DESC);
CREATE INDEX idx_audit_logs_record ON audit_logs(table_name,record_id,created_at DESC);
CREATE INDEX idx_background_jobs_ready ON background_jobs(status,run_after,priority DESC);
CREATE INDEX idx_user_sessions_user_expiry ON user_sessions(user_id,expires_at);

-- 11. Automatic updated_at maintenance
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DO $$
DECLARE t TEXT;
BEGIN
 FOREACH t IN ARRAY ARRAY['users','organizations','system_settings','projects','land_parcels','project_sections','plots','project_settings','customers','bookings','installment_plans','installments','payments','payment_refunds','notification_templates','background_jobs']
 LOOP
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', 'trg_'||t||'_updated_at', t);
 END LOOP;
END $$;

COMMIT;

-- First admin: create in a Node seed script after hashing the password with bcrypt/Argon2:
-- INSERT INTO users(full_name,email,password_hash,role) VALUES($1,$2,$3,'admin');
-- Optionally also assign roles table entry:
-- INSERT INTO user_roles(user_id,role_id) SELECT $user_id,id FROM roles WHERE name='admin';
-- Never allow public signup requests to set their own role to admin.
-- Business rules such as payment-allocation totals, refunds <= payment amount,
-- booking/plot status synchronization and installment balances must be enforced
-- in transactional service logic (or additional triggers) before production.
