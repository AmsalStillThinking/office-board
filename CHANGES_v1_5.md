# Office Board v1.5 (21 Nov 2026): one language, To-Do List, a comment as proof, to-do descriptions

Asked by the owner on 21 Nov 2026:
1. "Tidak ada 2 versi bahasa, hanya satu versi (mix language)": the EN switch is gone. The Indonesian texts, which
   already use the English words the office uses (Review, Kanban, Timeline, To-Do...), are the one version.
   `i18n.json` and `lib/messages.json` keep only `id`; the server ignores `X-Lang`.
2. "To Do Saya ganti jadi To-Do List": the menu item and the page title.
3. "Kirim Bukti gunakan Komentar juga, jadi tidak perlu mengirim file, file hanya opsional": a written comment is a
   kind of evidence (`evidence.kind = 'comment'`, the text in `name`), added with the Komentar box on the task panel.
   The proof rule itself is unchanged: Kirim bukti needs at least one proof item, and after Minta koreksi one new
   item; a comment is now such an item, so a file or link is optional. This changes rule R3 in practice
   ("Tanpa bukti, belum selesai" now accepts a comment): HANDOVER section 5 says the core rules are the director's
   decisions, so tell him.
4. "Tambahkan field deskripsi untuk To Do List": `todos.description` (optional, up to 1000 characters), shown under
   the title.

Database: an existing database gains `todos.description` and the wider evidence-kind check on the next start
(`lib/db.mjs`, nothing dropped). Tests: `test/v15.test.mjs` (V1-V3), the three tests that checked the English
version now check that there is one version; 5 mutants.
