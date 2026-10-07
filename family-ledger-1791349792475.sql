PRAGMA foreign_keys=ON;
BEGIN;

CREATE TABLE users (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT
);
CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE categories (
  category_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('expense','income')),
  icon TEXT,
  sort INTEGER
);
CREATE TABLE items (
  item_id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(category_id),
  name TEXT NOT NULL,
  created_by TEXT,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used INTEGER
);
CREATE INDEX idx_items_category ON items(category_id);
CREATE TABLE transactions (
  tx_id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  type TEXT NOT NULL CHECK (type IN ('expense','income')),
  category_id TEXT NOT NULL REFERENCES categories(category_id),
  item_name TEXT,
  amount REAL NOT NULL CHECK (amount > 0),
  note TEXT,
  created_at TEXT
);
CREATE INDEX idx_tx_date ON transactions(date);
CREATE INDEX idx_tx_category ON transactions(category_id);
INSERT INTO users (user_id,username,password_hash,salt,display_name,created_at) VALUES ('ufbccfad2','scott','c3d926c04046467d632f0df0451febd847d7dcb2232dd2bca661e01de51bd9b0','688aece5-de12-4efd-8f1c-d0d7a2822f97','Scott','2026-10-05 19:53:13');
INSERT INTO users (user_id,username,password_hash,salt,display_name,created_at) VALUES ('u16dfb021','chad','3a09bcef68415f8892f7ca7011a92c0dc49eb0a5ebbef76722c61bbeddc4d4f4','aeb089c0-9628-43d1-b599-614176902622','chad','2026-10-05 20:37:20');
INSERT INTO users (user_id,username,password_hash,salt,display_name,created_at) VALUES ('u233fda84','dora','87357a9b4dc21de0a2979a522493e6eed4ac2940085063fb36cf483dabacb873','dd4c9397-c078-459a-973b-a9172a6b5496','Mom','2026-10-05 23:02:30');
INSERT INTO users (user_id,username,password_hash,salt,display_name,created_at) VALUES ('ubac7a9c3','Tony','0dcd92e13d8c912482022153ef62d48d19a3934d6e2bb491919d946b0640889f','9927f556-7060-46d2-b75c-d805bcbdd460','Tony','2026-10-06 09:18:14');
INSERT INTO users (user_id,username,password_hash,salt,display_name,created_at) VALUES ('ud3127d69','Jim','a4f024cd274f4e16b5304d12d9a684c6bd113335f9539ec7eef052649a83026e','b1c80263-2256-4f83-a06f-881bbdf5d471','Jim','2026-10-06 09:23:00');
INSERT INTO categories (category_id,name,type,icon,sort) VALUES ('c01','飲食','expense','🍜',1);
INSERT INTO categories (category_id,name,type,icon,sort) VALUES ('c02','交通','expense','🚌',2);
INSERT INTO categories (category_id,name,type,icon,sort) VALUES ('c03','居家','expense','🏠',3);
INSERT INTO categories (category_id,name,type,icon,sort) VALUES ('c04','日用品','expense','🧴',4);
INSERT INTO categories (category_id,name,type,icon,sort) VALUES ('c05','水電瓦斯','expense','💡',5);
INSERT INTO categories (category_id,name,type,icon,sort) VALUES ('c06','醫療','expense','💊',6);
INSERT INTO categories (category_id,name,type,icon,sort) VALUES ('c07','教育','expense','📚',7);
INSERT INTO categories (category_id,name,type,icon,sort) VALUES ('c08','娛樂','expense','🎮',8);
INSERT INTO categories (category_id,name,type,icon,sort) VALUES ('c09','服飾','expense','👕',9);
INSERT INTO categories (category_id,name,type,icon,sort) VALUES ('c10','其他','expense','📦',10);
INSERT INTO categories (category_id,name,type,icon,sort) VALUES ('c11','繳入公戶','income','💰',11);
INSERT INTO categories (category_id,name,type,icon,sort) VALUES ('c12','其他收入','income','➕',13);
INSERT INTO items (item_id,category_id,name,created_by,use_count,last_used) VALUES ('i6fab7c86','c12','期初餘額','ubac7a9c3',2,1791283272351);
INSERT INTO items (item_id,category_id,name,created_by,use_count,last_used) VALUES ('icf98fd99','c03','10月份管理費','u233fda84',1,1791335078340);
INSERT INTO items (item_id,category_id,name,created_by,use_count,last_used) VALUES ('i13372ea0','c03','打掃阿姨清潔費（10月份）','u233fda84',2,1791335248568);
INSERT INTO transactions (tx_id,date,user_id,type,category_id,item_name,amount,note,created_at) VALUES ('td7f9beaa39fb','2026-10-06','ubac7a9c3','income','c12','期初餘額',28600,NULL,'2026-10-06 18:41:12');
INSERT INTO transactions (tx_id,date,user_id,type,category_id,item_name,amount,note,created_at) VALUES ('t136390bcc8ff','2026-10-07','u233fda84','expense','c03','10月份管理費',2500,NULL,'2026-10-07 09:04:38');
INSERT INTO transactions (tx_id,date,user_id,type,category_id,item_name,amount,note,created_at) VALUES ('tdfb7a86e100b','2026-10-07','u233fda84','expense','c03','打掃阿姨清潔費（10月份）',800,NULL,'2026-10-07 09:06:21');
COMMIT;