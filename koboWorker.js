
// Web Worker：先用 DP 求解，再用回溯法補足剩餘（混合式解法）
// 主要流程：先用 O(N*TARGET) 動態規劃反覆取出接近目標金額的購物車，剩餘部分再用回溯法優化。

(() => {
    const INF = Number.MAX_SAFE_INTEGER;

    function now() {
        return (typeof performance !== 'undefined' && performance.now)
            ? performance.now()
            : Date.now();
    }

    // Kobo 價格計算（與 UI 邏輯一致）
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

    // 將 mustbuys/optionals 轉為數字陣列
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

    // DP：找出一組總和等於 target 且 mustbuy 使用最多的子集
    // items：書籍陣列，回傳選中索引陣列或 null
    function findTargetSubsetDP(items, target) {
        const T = target | 0;
        const n = items.length | 0;
        if (T <= 0 || n === 0) return null;

        // bestMust[s]：湊到金額 s 時最多可用的 mustbuy 數量，-1 表示不可達
        const bestMust = new Int16Array(T + 1);
        for (let i = 0; i <= T; i++) bestMust[i] = -1;
        bestMust[0] = 0;

        const prevSum = new Int16Array(T + 1);  // previous sum before adding item i
        const prevIdx = new Int32Array(T + 1);  // which item index used to reach s
        for (let i = 0; i <= T; i++) { prevSum[i] = -1; prevIdx[i] = -1; }

        // 標準 0/1 背包 DP（s 遞減），同金額時優先選 mustbuy 多的
        for (let i = 0; i < n; i++) {
            const v = items[i].price.new.discountPrice.taxIncluded | 0;
            if (v > T || v <= 0) continue;
            const w = items[i].mustbuy ? 1 : 0;
            for (let s = T - v; s >= 0; s--) {
                const bm = bestMust[s];
                if (bm < 0) continue;
                const s2 = s + v;
                const cand = bm + w;
                // 只在 prevIdx[s2] == -1 時才更新，避免覆蓋已存在路徑
                if (cand > bestMust[s2]) {
                    bestMust[s2] = cand;
                    if (prevIdx[s2] === -1) {
                        prevSum[s2] = s;
                        prevIdx[s2] = i;
                    }
                }
            }
        }

        if (bestMust[T] < 0) return null; // 無法剛好湊到 target

        // 回溯重建選中索引
        const idxs = [];
        const used = new Set();
        let cur = T;
        let step = 0;
        while (cur > 0 && step++ < n) {
            const i = prevIdx[cur];
            if (i < 0) break;
            if (used.has(i)) {
                console.warn(`[DP回溯] index 重複: ${i}, idxs=${JSON.stringify(idxs)}, cur=${cur}`);
                break;
            }
            idxs.push(i);
            used.add(i);
            cur = prevSum[cur];
        }
        if (step >= n) {
            console.warn(`[DP回溯] 回溯步數超過 n，可能死循環: idxs=${JSON.stringify(idxs)}, cur=${cur}`);
        }
        return idxs.length ? idxs : null;
    }

    // 回溯法打包（原始回溯，含模板複製）
    function runBacktrackingPack(remaining, target, upperBound) {
        // 依金額由大到小排序，利於剪枝
        remaining.sort((a, b) => b.price.new.discountPrice.taxIncluded - a.price.new.discountPrice.taxIncluded);

        // 準備後綴和，利於剪枝
        const vals = remaining.map(b => b.price.new.discountPrice.taxIncluded);
        const suffixSum = new Array(vals.length + 1).fill(0);
        for (let i = vals.length - 1; i >= 0; i--) suffixSum[i] = suffixSum[i + 1] + vals[i];

        const carts = [];
        const cartsSums = [];
        const cartsMust = [];
        let currentTotal = 0;
        const used = new Array(remaining.length).fill(false);

        const INF = Number.MAX_SAFE_INTEGER;
        let bestCarts = [];
        let bestRewards = -1;
        let bestWaste = INF;
        let bestMustLeft = INF;

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
                bestCarts = carts.map(c => c.slice());
            }
        }
        function buildTemplateSignature(cart) {
            const m = new Map();
            for (const bk of cart) {
                const v = bk.price.new.discountPrice.taxIncluded;
                m.set(v, (m.get(v) || 0) + 1);
            }
            return m;
        }
        function replicateTemplateFromSuffix(startIdx, template) {
            const buckets = new Map(); // val -> { must: number[], opt: number[] }
            for (let k = startIdx; k < remaining.length; k++) {
                if (used[k]) continue;
                const vv = vals[k];
                const isM = !!remaining[k].mustbuy;
                if (!buckets.has(vv)) buckets.set(vv, { must: [], opt: [] });
                const bucket = buckets.get(vv);
                (isM ? bucket.must : bucket.opt).push(k);
            }
            let maxCopies = Infinity;
            for (const [val, cnt] of template.entries()) {
                const b = buckets.get(val) || { must: [], opt: [] };
                const avail = b.must.length + b.opt.length;
                maxCopies = Math.min(maxCopies, Math.floor(avail / cnt));
                if (maxCopies === 0) break;
            }
            if (!isFinite(maxCopies) || maxCopies <= 0) return { copies: [], indices: [] };

            const copies = [];
            const chosenIndices = [];
            for (let c = 0; c < maxCopies; c++) {
                const newCart = [];
                const pickSet = [];
                for (const [val, cnt] of template.entries()) {
                    const b = buckets.get(val);
                    for (let t = 0; t < cnt; t++) {
                        let idx;
                        if (b.must.length > 0) idx = b.must.shift(); else idx = b.opt.shift();
                        pickSet.push(idx);
                        newCart.push(remaining[idx]);
                    }
                }
                copies.push(newCart);
                chosenIndices.push(...pickSet);
            }
            return { copies, indices: chosenIndices };
        }
        function go(i) {
            const remainingSum = suffixSum[i] || 0;
            if (bestRewards >= 0) {
                const maxRewards = Math.floor((currentTotal + remainingSum) / target);
                if (maxRewards < bestRewards) return;
            }
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
            if (used[i]) { go(i + 1); return; }

            const book = remaining[i];
            const v = book.price.new.discountPrice.taxIncluded;
            const isMust = !!book.mustbuy;
            const seen = new Set();

            for (let j = 0; j < carts.length; j++) {
                if (cartsSums[j] >= target) continue;
                if (upperBound > 0 && cartsSums[j] + v > upperBound) continue;

                const key = cartsMust[j] + '|' + cartsSums[j];
                if (seen.has(key)) continue;
                seen.add(key);

                carts[j].push(book);
                cartsSums[j] += v;
                if (isMust) cartsMust[j] += 1;
                currentTotal += v;

                // 若金額等於或接近 target，嘗試複製模板
                let replicated = null;
                let x = cartsSums[j] - target;
                if (x >= 0 && x <= 100) {
                    const tmpl = buildTemplateSignature(carts[j]);
                    replicated = replicateTemplateFromSuffix(i + 1, tmpl);
                    if (replicated.copies.length > 0) {
                        for (const idx of replicated.indices) used[idx] = true;
                        for (const copyCart of replicated.copies) {
                            carts.push(copyCart);
                            cartsSums.push(target);
                            const mustCnt = copyCart.reduce((acc, bk) => acc + (bk.mustbuy ? 1 : 0), 0);
                            cartsMust.push(mustCnt);
                            currentTotal += target;
                        }
                    }
                }

                go(i + 1);

                currentTotal -= v;
                if (isMust) cartsMust[j] -= 1;
                cartsSums[j] -= v;
                carts[j].pop();

                if (replicated && replicated.copies.length > 0) {
                    for (let r = 0; r < replicated.copies.length; r++) {
                        currentTotal -= target;
                        cartsMust.pop();
                        cartsSums.pop();
                        carts.pop();
                    }
                    for (const idx of replicated.indices) used[idx] = false;
                }
            }

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
        return bestCarts;
    }

    // 先用 DP 打包，再用回溯補足（混合式）
    function solveCarts({ mustbuys, optionals, target, discount, upperBound, mode, dpTolerance }) {
        // 建立書籍物件並預先計算價格
        const books = [];
        for (const p of mustbuys) {
            books.push({ mustbuy: true, price: calcKoboPrice(p, discount) });
        }
        for (const p of optionals) {
            books.push({ mustbuy: false, price: calcKoboPrice(p, discount) });
        }

        // 預處理：單本書達標者直接成為一車
        const preProcessedCarts = [];
        const remainingAll = [];
        for (const b of books) {
            const v = b.price.new.discountPrice.taxIncluded;
            if (v >= target) preProcessedCarts.push([b]); else remainingAll.push(b);
        }
        // 第一階段：DP 快速取出接近 target 的組合（若 mode 禁用 DP 或 upperBound < target 則跳過）
        const useDP = (mode === 'dp' || mode === 'hybrid');
        const dpCarts = [];
        let remaining = remainingAll.slice();
        if (useDP && !(upperBound > 0 && upperBound < target)) {
            // 在本地陣列反覆取出子集
            const tol = (typeof dpTolerance === 'number' && isFinite(dpTolerance)) ? Math.floor(dpTolerance) : 10;
            let maxS = target + Math.max(0, tol);
            if (upperBound > 0) maxS = Math.min(maxS, upperBound);

            for (let s = target; s <= maxS; s++) {
                let guard = 0;
                while (guard++ < 256) {
                    if (remaining.length === 0) break;
                    const picked = findTargetSubsetDP(remaining, s);
                    if (!picked) break;
                    if (s === 1900) {
                        debugger;
                    }
                    const cart = [];
                    const pickedSet = new Set(picked);
                    for (const i of picked) cart.push(remaining[i]);
                    dpCarts.push(cart);
                    const kept = [];
                    for (let i = 0; i < remaining.length; i++) if (!pickedSet.has(i)) kept.push(remaining[i]);
                    remaining = kept;
                }
                if (remaining.length === 0) break;
            }
        }

        // 第二階段（可選）：回溯法補足剩餘
        let extraCarts = [];
        const useBacktracking = (mode === 'bt' || mode === 'hybrid');
        if (useBacktracking && remaining.length > 0) {
            extraCarts = runBacktrackingPack(remaining.slice(), target, upperBound);
        } else if (mode === 'dp' && remaining.length > 0) {
            // dp 模式下不回溯，剩餘每本書各自成為一車，前端會顯示為「可下次再買」
            extraCarts = remaining.map(b => [b]);
        }

        // 合併所有階段結果
        const solution = preProcessedCarts.concat(dpCarts, extraCarts);
        solution.sort((a, b) => sumCart(a) - sumCart(b));
        return solution;
    }

    self.onmessage = function (e) {
        try {
            const { mustbuys, optionals, target, safeDiscount, discount, upperBound, mode, dpTolerance } = e.data || {};
            // 優先使用 safeDiscount，否則用 discount
            let d = typeof safeDiscount === 'number' ? safeDiscount : discount;
            if (typeof d !== 'number' || isNaN(d) || d <= 0 || d > 1) d = 1;

            const mb = normalizePriceList(mustbuys);
            const op = normalizePriceList(optionals);
            const tgt = Number(target) || 0;
            const ub = Number(upperBound) || 0;

            const start = now();
            const solutionCarts = solveCarts({ mustbuys: mb, optionals: op, target: tgt, discount: d, upperBound: ub, mode, dpTolerance });
            const end = now();

            const metrics = evaluateCarts(solutionCarts, tgt);
            self.postMessage({
                solutionCarts,
                booksCount: mb.length + op.length,
                execTime: (end - start) / 1000,
                metrics,
                mode: (mode || 'hybrid'),
            });
        } catch (err) {
            self.postMessage({ error: err && err.message ? err.message : String(err), stack: err && err.stack ? err.stack : undefined });
        }
    };
})();

