## KoboShopping

本專案修改自 [wdshieh](https://github.com/wdshieh) [(web)](https://wdshieh.github.io) - [KoboShopping Optimization](https://wdshieh.github.io/KoboShopping.html)

### 修改概要

* 修正平均計算分母

* 效能優化

* 調整部分 UI

    * 計算中/計算時間

    * 單一購物車內排序

* 個人撰寫偏好

* GitHub Copilot 提出之修改建議

### 效能優化項目

* 部分改用 ES6 語法提升效能

* 單本超過門檻直接放入購物車

* 書籍添加到陣列後按照必買、價格排序以提早剪枝

* 購物車超過門檻即停止嘗試添加新書

* 使用 async 延遲執行確保 UI 響應
