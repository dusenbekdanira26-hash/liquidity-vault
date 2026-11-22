// В каждом модуле своя функция `handler`; glob-реэкспорт нужен Anchor
// (#[program] ищет сгенерированные `__client_accounts_*`), а вызываем мы
// всегда полным путём `instructions::<модуль>::handler`.
#![allow(ambiguous_glob_reexports)]

pub mod deposit;
pub mod initialize_vault;
pub mod open_user_position;
pub mod withdraw;

pub use deposit::*;
pub use initialize_vault::*;
pub use open_user_position::*;
pub use withdraw::*;
