() => { window.__cap.stop = true;
        return {stopping:true, stats: window.__cap.stats, dumped: window.__cap.dumped,
                inMemory: window.__cap.pages.length}; }
