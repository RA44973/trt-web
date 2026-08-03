-- VOG Мобильный помощник: помесячные продажи ТРТ.
-- Выполнить один раз в той же YDB-базе, где работает функция trt-api.
-- Повторная загрузка периода создаёт новый набор и только затем переключает
-- активную версию месяца, поэтому ранее загруженные данные не теряются при сбое.

CREATE TABLE trt_sales_monthly (
    year Uint32 NOT NULL,
    month Uint32 NOT NULL,
    import_id Utf8 NOT NULL,
    point_id Utf8 NOT NULL,
    quantity Double NOT NULL,
    direction Utf8,
    manager Utf8,
    client Utf8,
    location Utf8,
    source_rows Utf8,
    file_name Utf8,
    uploaded_by Utf8,
    uploaded_at Timestamp,
    PRIMARY KEY (year, month, import_id, point_id)
);

CREATE TABLE trt_sales_periods (
    year Uint32 NOT NULL,
    month Uint32 NOT NULL,
    active_import_id Utf8 NOT NULL,
    file_name Utf8,
    uploaded_by Utf8,
    uploaded_at Timestamp,
    row_count Uint32,
    total_quantity Double,
    PRIMARY KEY (year, month)
);
