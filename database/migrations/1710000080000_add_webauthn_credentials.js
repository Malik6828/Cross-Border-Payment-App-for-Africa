exports.up = (pgm) => {
  pgm.createTable('webauthn_credentials', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    user_id: { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'cascade' },
    credential_id: { type: 'text', notNull: true, unique: true },
    device_label: { type: 'text' },
    created_at: { type: 'timestamptz', default: pgm.func('NOW()') },
    last_used_at: { type: 'timestamptz' },
    revoked_at: { type: 'timestamptz' },
  });
  pgm.createIndex('webauthn_credentials', 'user_id');
};

exports.down = (pgm) => {
  pgm.dropTable('webauthn_credentials');
};
