// Web Worker: exact/backtracking solver (no DP)

// This worker mirrors the message protocol of koboWorker_dp.js but implements
// a pure backtracking search similar to the original _go() in-page script.

(() => {
    const INF = Number.MAX_SAFE_INTEGER;

    function now() {
        return (typeof performance !== 'undefined' && performance.now)
            ? performance.now()
            : Date.now();
    }

    // Kobo price calculation (aligned with UI logic)
    function calcKoboPrice(rawPrice, discount) {
        const price = {
            origin: { taxIncluded: rawPrice, taxExcluded: null, tax: null },
            discountAmount: null,
            new: {
                displayPrice: { taxIncluded: null, taxExcluded: null },
                discountPrice: { taxIncluded: null, taxExcluded: null },
                tax: null,
            },
        };

        price.origin.taxExcluded = Math.round(price.origin.taxIncluded / 1.05);
        price.origin.tax = rawPrice - price.origin.taxExcluded;

        if (discount === 1) {
            price.discountAmount = 0;
            price.new.displayPrice.taxIncluded = price.origin.taxIncluded;
            price.new.displayPrice.taxExcluded = price.origin.taxExcluded;
            price.new.discountPrice.taxIncluded = price.origin.taxIncluded;
            price.new.discountPrice.taxExcluded = price.origin.taxExcluded;
            price.new.tax = price.origin.tax;
        } else {
            price.discountAmount = Math.floor(price.origin.taxExcluded * (1 - discount));
            price.new.displayPrice.taxExcluded = price.origin.taxExcluded;
            price.new.discountPrice.taxExcluded = price.new.displayPrice.taxExcluded - price.discountAmount;
            price.new.tax = Math.round(price.new.discountPrice.taxExcluded * 0.05);
            price.new.displayPrice.taxIncluded = price.new.displayPrice.taxExcluded + price.new.tax;
            price.new.discountPrice.taxIncluded = price.new.discountPrice.taxExcluded + price.new.tax;
        }
        return price;
    }

    function sumCart(cart) {
        return cart.reduce((s, b) => s + b.price.new.discountPrice.taxIncluded, 0);
    }

    function evaluateCarts(carts, target) {
        let rewards = 0, waste = 0, mustbuy_left = 0;
        for (const cart of carts) {
            const s = sumCart(cart);
            if (s >= target) {
                rewards++;
                waste += s - target;
            } else {
                mustbuy_left += cart.reduce((c, b) => c + (b.mustbuy ? 1 : 0), 0);
            }
        }
        return { rewards, waste, mustbuy_left };
    }

    // Normalize incoming mustbuys/optionals into number arrays
    function normalizePriceList(list) {
        if (Array.isArray(list)) return list.map(Number).filter(x => !isNaN(x) && x > 0);
        if (typeof list === 'string') {
            return list
                .trim()
                .split(/\s+/)
                .map(Number)
                .filter(x => !isNaN(x) && x > 0);
        }
        return [];
    }

    // Pack using backtracking (exact search)
    function solveExact({ mustbuys, optionals, target, discount, upperBound }) {
        // Build book objects with price precomputed
        const books = [];
        for (const p of mustbuys) {
            books.push({ mustbuy: true, price: calcKoboPrice(p, discount) });
        }
        for (const p of optionals) {
            books.push({ mustbuy: false, price: calcKoboPrice(p, discount) });
        }

        // Preprocess: pull out any single book that already reaches target into its own cart
        const preProcessedCarts = [];
        const remaining = [];
        for (const b of books) {
            const v = b.price.new.discountPrice.taxIncluded;
            if (v >= target) preProcessedCarts.push([b]); else remaining.push(b);
        }

        // Sort remaining by value desc to improve pruning
        remaining.sort((a, b) => b.price.new.discountPrice.taxIncluded - a.price.new.discountPrice.taxIncluded);

        // Prepare suffix sums for pruning
        const vals = remaining.map(b => b.price.new.discountPrice.taxIncluded);
        const suffixSum = new Array(vals.length + 1).fill(0);
        for (let i = vals.length - 1; i >= 0; i--) suffixSum[i] = suffixSum[i + 1] + vals[i];

        // State for recursion
        const carts = [];
        const cartsSums = [];
        const cartsMust = [];
        let currentTotal = 0;

        // Best solution trackers (lexicographic: mustbuy_left min, rewards max, waste min)
        let bestCarts = [];
        let bestRewards = -1;
        let bestWaste = INF;
        let bestMustLeft = INF;

        function considerSolution() {
            const { rewards, waste, mustbuy_left } = evaluateCarts(carts, target);
            const better =
                mustbuy_left < bestMustLeft ||
                (mustbuy_left === bestMustLeft && (
                    rewards > bestRewards || (rewards === bestRewards && waste < bestWaste)
                ));
            if (better) {
                bestMustLeft = mustbuy_left;
                bestRewards = rewards;
                bestWaste = waste;
                bestCarts = carts.map(c => c.slice()); // deep enough (book objects reused)
            }
        }

        function go(i) {
            // Upper bound on achievable rewards from current state
            const remainingSum = suffixSum[i] || 0;
            if (bestRewards >= 0) {
                const maxRewards = Math.floor((currentTotal + remainingSum) / target);
                if (maxRewards < bestRewards) return; // can't beat current
            }

            // Lower bound on mustbuys left: carts that can never reach target with remaining items
            if (bestMustLeft < INF) {
                let lb = 0;
                for (let j = 0; j < carts.length; j++) {
                    if (cartsSums[j] < target && cartsSums[j] + remainingSum < target) lb += cartsMust[j];
                }
                if (lb > bestMustLeft) return;
            }

            if (i === remaining.length) {
                considerSolution();
                return;
            }

            const book = remaining[i];
            const v = book.price.new.discountPrice.taxIncluded;
            const isMust = !!book.mustbuy;

            // symmetry dedup within this level: same (sum, mustCnt) considered equivalent
            const seen = new Set();

            for (let j = 0; j < carts.length; j++) {
                // Skip adding to carts already eligible, it's usually better to start a new cart
                if (cartsSums[j] >= target) continue;
                // Respect upperBound (if provided and positive): disallow exceeding it in cart (allow equality)
                if (upperBound > 0 && cartsSums[j] + v > upperBound) continue;

                const key = cartsMust[j] + '|' + cartsSums[j];
                if (seen.has(key)) continue;
                seen.add(key);

                carts[j].push(book);
                cartsSums[j] += v;
                if (isMust) cartsMust[j] += 1;
                currentTotal += v;

                go(i + 1);

                currentTotal -= v;
                if (isMust) cartsMust[j] -= 1;
                cartsSums[j] -= v;
                carts[j].pop();
            }

            // Try placing into a new cart (respect upperBound too)
            if (upperBound <= 0 || v <= upperBound) {
                carts.push([book]);
                cartsSums.push(v);
                cartsMust.push(isMust ? 1 : 0);
                currentTotal += v;

                go(i + 1);

                currentTotal -= v;
                cartsMust.pop();
                cartsSums.pop();
                carts.pop();
            }
        }

        go(0);

        // Merge with preprocessed carts and sort by sum asc for stable presentation
        const solution = preProcessedCarts.concat(bestCarts);
        solution.sort((a, b) => sumCart(a) - sumCart(b));
        return solution;
    }

    self.onmessage = function (e) {
        try {
            const { mustbuys, optionals, target, safeDiscount, discount, upperBound, mode } = e.data || {};
            // prefer safeDiscount if provided, else discount
            let d = typeof safeDiscount === 'number' ? safeDiscount : discount;
            if (typeof d !== 'number' || isNaN(d) || d <= 0 || d > 1) d = 1;

            const mb = normalizePriceList(mustbuys);
            const op = normalizePriceList(optionals);
            const tgt = Number(target) || 0;
            const ub = Number(upperBound) || 0;

            const start = now();
            const solutionCarts = solveExact({ mustbuys: mb, optionals: op, target: tgt, discount: d, upperBound: ub });
            const end = now();

            const metrics = evaluateCarts(solutionCarts, tgt);
            self.postMessage({
                solutionCarts,
                booksCount: mb.length + op.length,
                execTime: (end - start) / 1000,
                metrics,
                mode: (mode || 'exact'),
            });
        } catch (err) {
            self.postMessage({ error: err && err.message ? err.message : String(err), stack: err && err.stack ? err.stack : undefined });
        }
    };
})();

