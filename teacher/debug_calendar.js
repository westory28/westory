
(async () => {
    try {
        const config = { year: 2026, semester: 1 };
        const path = `years/${config.year}/semesters/${config.semester}/calendar`;
        console.log("Checking path:", path);

        const snapshot = await window.db.collection(path).get();
        console.log("Total Documents:", snapshot.size);

        snapshot.forEach(doc => {
            console.log(doc.id, doc.data());
        });
    } catch (e) {
        console.error("Debug Error:", e);
    }
})();
