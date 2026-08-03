import base64
import binascii
import hashlib
import hmac
import json
import math
import os
import re
import secrets
import time
import html
import smtplib
import ssl
from email.message import EmailMessage
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta
from difflib import SequenceMatcher
from io import BytesIO

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
import ydb
import ydb.iam
from PIL import Image, ImageOps, UnidentifiedImageError


PASSWORD_ITERATIONS = 310_000
MAX_VISITS_PER_SYNC = 100
MAX_TASKS_PER_SYNC = 100
MAX_MEDIA_FILE_SIZE = 80 * 1024 * 1024
MAX_MEDIA_LIST = 1000
MEDIA_UPLOAD_URL_TTL = 900
MEDIA_DOWNLOAD_URL_TTL = 1800
MEDIA_THUMBNAIL_MAX_EDGE = 720
MEDIA_THUMBNAIL_QUALITY = 78
MEDIA_THUMBNAIL_MAX_SOURCE_SIZE = 30 * 1024 * 1024
API_VERSION = "2026-08-03-sales-import-invites-2"

_s3_client = None


driver = ydb.Driver(
    endpoint=os.environ["YDB_ENDPOINT"],
    database=os.environ["YDB_DATABASE"],
    credentials=ydb.iam.MetadataUrlCredentials(),
)

driver.wait(
    fail_fast=True,
    timeout=10,
)

pool = ydb.QuerySessionPool(driver)


def get_s3_client():
    global _s3_client

    if _s3_client is not None:
        return _s3_client

    required = (
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "S3_ENDPOINT",
        "S3_BUCKET",
    )

    missing = [
        name for name in required
        if not os.environ.get(name)
    ]

    if missing:
        raise RuntimeError(
            "Не настроены переменные Object Storage: "
            + ", ".join(missing)
        )

    _s3_client = boto3.client(
        "s3",
        endpoint_url=os.environ["S3_ENDPOINT"],
        region_name=os.environ.get(
            "AWS_DEFAULT_REGION",
            "ru-central1",
        ),
        aws_access_key_id=os.environ[
            "AWS_ACCESS_KEY_ID"
        ],
        aws_secret_access_key=os.environ[
            "AWS_SECRET_ACCESS_KEY"
        ],
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path"},
        ),
    )

    return _s3_client


def s3_bucket_name():
    return os.environ["S3_BUCKET"]


def json_response(status_code, data):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": (
                "Authorization, Content-Type"
            ),
            "Access-Control-Allow-Methods": (
                "GET, POST, OPTIONS"
            ),
        },
        "body": json.dumps(
            data,
            ensure_ascii=False,
        ),
    }


def utf8(value):
    return ydb.TypedValue(
        str(value),
        ydb.PrimitiveType.Utf8,
    )


def uint32(value):
    return ydb.TypedValue(
        int(value),
        ydb.PrimitiveType.Uint32,
    )


def uint64(value):
    return ydb.TypedValue(
        int(value),
        ydb.PrimitiveType.Uint64,
    )


def boolean(value):
    return ydb.TypedValue(
        bool(value),
        ydb.PrimitiveType.Bool,
    )


def optional_utf8(value):
    return ydb.TypedValue(
        value,
        ydb.OptionalType(
            ydb.PrimitiveType.Utf8
        ),
    )


def optional_double(value):
    return ydb.TypedValue(
        value,
        ydb.OptionalType(
            ydb.PrimitiveType.Double
        ),
    )


def optional_uint32(value):
    return ydb.TypedValue(
        value,
        ydb.OptionalType(
            ydb.PrimitiveType.Uint32
        ),
    )


def timestamp(value):
    return ydb.TypedValue(
        int(value),
        ydb.PrimitiveType.Timestamp,
    )


def optional_timestamp(value):
    return ydb.TypedValue(
        value,
        ydb.OptionalType(
            ydb.PrimitiveType.Timestamp
        ),
    )


def execute_query(query, parameters=None):
    return pool.execute_with_retries(
        query,
        parameters or {},
    )


ACCESS_ROLE_LABELS = {
    "GD": "Генеральный директор",
    "KD": "Коммерческий директор",
    "RRO": "Руководитель регионального отдела",
    "MANAGER": "Менеджер",
}

_access_config_cache = None
_access_config_cache_expires_at = 0.0
_trt_payload_cache = None
_trt_points_by_id_cache = None


def read_dynamic_employee_directory():
    try:
        result_sets = execute_query(
            """
            SELECT
                employee_id,
                full_name,
                display_name,
                position,
                access_role,
                role_label,
                direction,
                manager_id,
                email,
                is_active
            FROM employee_directory;
            """
        )
    except Exception:
        # До выполнения SQL-миграции система продолжает работать
        # на встроенном справочнике сотрудников.
        return []

    items = []
    for row in result_sets[0].rows:
        email = normalize_login(row.email)
        full_name = str(row.full_name or "").strip()
        display_name = str(
            row.display_name
            or employee_display_name(full_name)
        ).strip()
        access_role = str(
            row.access_role or "MANAGER"
        ).upper()
        employee_id = str(row.employee_id or "").strip()

        if not employee_id:
            continue

        items.append(
            {
                "employeeId": employee_id,
                "fullName": full_name,
                "displayName": display_name,
                "position": str(row.position or ""),
                "accessRole": access_role,
                "roleLabel": str(
                    row.role_label
                    or ACCESS_ROLE_LABELS.get(
                        access_role,
                        access_role,
                    )
                ),
                "direction": str(row.direction or ""),
                "email": email,
                "loginAliases": [email] if email else [],
                "nameAliases": [
                    full_name,
                    display_name,
                ],
                "managerEmployeeId": str(
                    row.manager_id or ""
                ),
                "managerFullName": "",
                "isActive": bool(row.is_active),
                "source": "employee_directory",
            }
        )

    return items


def invalidate_access_config_cache():
    global _access_config_cache
    global _access_config_cache_expires_at
    _access_config_cache = None
    _access_config_cache_expires_at = 0.0


def load_access_config():
    global _access_config_cache
    global _access_config_cache_expires_at

    now = time.monotonic()
    if (
        _access_config_cache is not None
        and now < _access_config_cache_expires_at
    ):
        return _access_config_cache

    path = os.path.join(
        os.path.dirname(__file__),
        "employees_access.json",
    )

    with open(path, "r", encoding="utf-8") as source:
        payload = json.load(source)

    employees = payload.get("employees")
    if not isinstance(employees, list):
        employees = []

    merged_by_id = {}
    for item in employees:
        if not isinstance(item, dict):
            continue
        employee_id = str(item.get("employeeId") or "").strip()
        if employee_id:
            merged_by_id[employee_id] = dict(item)

    # Записи, созданные в интерфейсе, имеют приоритет над
    # встроенным справочником и становятся доступны без деплоя.
    for item in read_dynamic_employee_directory():
        employee_id = str(item.get("employeeId") or "").strip()
        if employee_id:
            merged_by_id[employee_id] = item

    by_id = {}
    by_login = {}
    by_name = {}

    for item in merged_by_id.values():
        employee_id = str(
            item.get("employeeId") or ""
        ).strip()

        if not employee_id:
            continue

        by_id[employee_id] = item

        for login in (
            [item.get("email")]
            + list(item.get("loginAliases") or [])
        ):
            normalized = normalize_login(login)
            if normalized:
                by_login[normalized] = item

        for name in (
            [item.get("fullName"), item.get("displayName")]
            + list(item.get("nameAliases") or [])
        ):
            normalized = normalize_access_person_name(name)
            if normalized:
                by_name[normalized] = item

    children = {}
    for item in by_id.values():
        manager_id = str(
            item.get("managerEmployeeId") or ""
        ).strip()
        if manager_id:
            children.setdefault(
                manager_id,
                [],
            ).append(item["employeeId"])

    _access_config_cache = {
        "payload": payload,
        "employees": list(by_id.values()),
        "by_id": by_id,
        "by_login": by_login,
        "by_name": by_name,
        "children": children,
    }
    # Короткий TTL нужен, чтобы новые сотрудники появились
    # и на других тёплых экземплярах Cloud Function.
    _access_config_cache_expires_at = now + 1.0
    return _access_config_cache


def normalize_access_person_name(value):
    value = str(value or "").strip()
    value = re.sub(
        r"_(плитка|обои)\s*$",
        "",
        value,
        flags=re.IGNORECASE,
    )
    value = value.replace("Ё", "Е").replace("ё", "е")
    value = re.sub(
        r"[^A-Za-zА-Яа-я0-9]+",
        " ",
        value,
    )
    return " ".join(
        value.lower().split()
    )


def load_trt_payload():
    global _trt_payload_cache
    global _trt_points_by_id_cache

    if _trt_payload_cache is not None:
        return _trt_payload_cache

    path = os.path.join(
        os.path.dirname(__file__),
        "trt_data.json",
    )

    with open(path, "r", encoding="utf-8") as source:
        payload = json.load(source)

    points = payload.get("points")
    if not isinstance(points, list):
        points = []

    _trt_payload_cache = payload
    _trt_points_by_id_cache = {
        str(point.get("id") or ""): point
        for point in points
        if str(point.get("id") or "")
    }

    return _trt_payload_cache


def trt_point_by_id(point_id):
    load_trt_payload()
    return (_trt_points_by_id_cache or {}).get(
        str(point_id or "")
    )


def resolve_access_profile(
    employee_id,
    full_name,
    login,
    legacy_role,
):
    config = load_access_config()

    employee_id = str(
        employee_id or ""
    ).strip()

    item = config["by_id"].get(
        employee_id
    )

    if item is None:
        item = config["by_login"].get(
            normalize_login(login)
        )

    if item is None:
        item = config["by_name"].get(
            normalize_access_person_name(
                full_name
            )
        )

    if item is None:
        fallback_role = (
            "GD"
            if str(legacy_role or "").lower()
            == "admin"
            else "MANAGER"
        )

        item = {
            "employeeId": employee_id,
            "fullName": str(
                full_name or employee_id
            ),
            "displayName": employee_display_name(
                full_name or employee_id
            ),
            "position": (
                "ГД"
                if fallback_role == "GD"
                else "Менеджер"
            ),
            "accessRole": fallback_role,
            "roleLabel": (
                ACCESS_ROLE_LABELS[
                    fallback_role
                ]
            ),
            "direction": None,
            "email": normalize_login(login),
            "managerEmployeeId": None,
            "managerFullName": None,
            "isActive": True,
            "fallback": True,
        }

    profile = dict(item)
    profile["employeeId"] = str(
        profile.get("employeeId")
        or employee_id
    )
    profile["accessRole"] = str(
        profile.get("accessRole")
        or "MANAGER"
    ).upper()
    profile["roleLabel"] = str(
        profile.get("roleLabel")
        or ACCESS_ROLE_LABELS.get(
            profile["accessRole"],
            profile["accessRole"],
        )
    )
    profile["direction"] = str(
        profile.get("direction") or ""
    )
    profile["visibleEmployeeIds"] = sorted(
        access_visible_employee_ids(
            profile
        )
    )
    return profile


def access_visible_employee_ids(profile):
    config = load_access_config()
    role = str(
        profile.get("accessRole") or ""
    ).upper()
    employee_id = str(
        profile.get("employeeId") or ""
    )
    direction = str(
        profile.get("direction") or ""
    )

    if role == "GD":
        return set(config["by_id"].keys())

    if role == "KD":
        return {
            item["employeeId"]
            for item in config["employees"]
            if str(item.get("direction") or "")
            == direction
        }

    if role == "RRO":
        visible = {employee_id}
        stack = list(
            config["children"].get(
                employee_id,
                [],
            )
        )

        while stack:
            child_id = stack.pop()
            child = config["by_id"].get(
                child_id
            )
            if child is None:
                continue

            if str(child.get("direction") or "") == direction:
                visible.add(child_id)
                stack.extend(
                    config["children"].get(
                        child_id,
                        [],
                    )
                )

        return visible

    return {employee_id} if employee_id else set()


def access_profile_for_context(context):
    cached = context.get("access")
    if cached is not None:
        return cached

    session = context["session"]
    employee = context["employee"]

    profile = resolve_access_profile(
        employee.employee_id,
        employee.full_name,
        session.login,
        employee.user_role,
    )
    context["access"] = profile
    return profile


def access_user_payload(
    employee,
    login,
):
    profile = resolve_access_profile(
        employee.employee_id,
        employee.full_name,
        login,
        employee.user_role,
    )

    return {
        "employee_id": profile["employeeId"],
        "full_name": (
            profile.get("fullName")
            or employee.full_name
        ),
        "display_name": (
            profile.get("displayName")
            or employee_display_name(
                profile.get("fullName")
                or employee.full_name
            )
        ),
        "role": profile["accessRole"],
        "role_label": profile["roleLabel"],
        "direction": profile["direction"],
        "login": login,
        "is_admin": (
            str(employee.user_role or "").lower()
            == "admin"
        ),
    }


def point_manager_employee_id(point):
    direct = str(
        point.get("managerEmployeeId") or ""
    ).strip()

    if direct:
        return direct

    manager_name = normalize_access_person_name(
        point.get("manager")
    )

    item = load_access_config()[
        "by_name"
    ].get(manager_name)

    return (
        str(item.get("employeeId") or "")
        if item is not None
        else ""
    )


def access_can_view_point(profile, point):
    if not isinstance(point, dict):
        return False

    role = str(
        profile.get("accessRole") or ""
    ).upper()
    direction = str(
        profile.get("direction") or ""
    )
    point_direction = str(
        point.get("direction") or ""
    )

    if role == "GD":
        return True

    if role == "KD":
        return bool(direction) and (
            point_direction == direction
        )

    if direction and point_direction != direction:
        return False

    manager_employee_id = (
        point_manager_employee_id(point)
    )

    return manager_employee_id in set(
        profile.get("visibleEmployeeIds")
        or access_visible_employee_ids(
            profile
        )
    )


def access_can_view_point_id(
    profile,
    point_id,
):
    return access_can_view_point(
        profile,
        trt_point_by_id(point_id),
    )


def access_can_write_point(
    profile,
    point_id,
):
    return access_can_view_point_id(
        profile,
        point_id,
    )


def filtered_trt_payload(profile):
    payload = load_trt_payload()
    filtered = dict(payload)
    filtered["points"] = [
        point
        for point in payload.get(
            "points",
            [],
        )
        if access_can_view_point(
            profile,
            point,
        )
    ]
    filtered["access"] = {
        "role": profile.get("accessRole"),
        "roleLabel": profile.get("roleLabel"),
        "direction": profile.get("direction"),
        "employeeId": profile.get("employeeId"),
        "visibleEmployeeIds": profile.get(
            "visibleEmployeeIds",
            [],
        ),
        "pointCount": len(
            filtered["points"]
        ),
    }
    return filtered


def is_general_director(context):
    return (
        access_profile_for_context(
            context
        ).get("accessRole")
        == "GD"
    )


def is_system_admin(context):
    """Администратор системы — отдельный признак, не равный роли ГД."""
    employee = context.get("employee")
    return (
        employee is not None
        and str(
            getattr(employee, "user_role", "")
            or ""
        ).lower() == "admin"
    )


def normalize_event(event):
    if event is None:
        return {}

    if isinstance(event, str):
        try:
            event = json.loads(event)
        except json.JSONDecodeError:
            return {}

    if not isinstance(event, dict):
        return {}

    return event


def parse_body(event):
    body = event.get("body")

    if body is None:
        return {}

    if isinstance(body, dict):
        return body

    if not isinstance(body, str):
        return {}

    if event.get("isBase64Encoded"):
        try:
            body = base64.b64decode(
                body
            ).decode("utf-8")
        except Exception:
            return {}

    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        return {}

    if not isinstance(parsed, dict):
        return {}

    return parsed


def get_header(event, header_name):
    headers = event.get("headers") or {}

    if not isinstance(headers, dict):
        return ""

    target_name = header_name.lower()

    for key, value in headers.items():
        if str(key).lower() == target_name:
            return str(value or "")

    return ""


def get_query_parameter(event, name):
    parameters = (
        event.get("queryStringParameters")
        or {}
    )

    if not isinstance(parameters, dict):
        return ""

    return str(parameters.get(name) or "").strip()


def safe_object_segment(value, fallback="item"):
    cleaned = re.sub(
        r"[^A-Za-z0-9._-]+",
        "-",
        str(value or "").strip(),
    ).strip("-._")

    return (cleaned or fallback)[:120]


def media_extension(file_name, content_type):
    suffix = os.path.splitext(
        str(file_name or "")
    )[1].lower()

    if re.fullmatch(r"\.[a-z0-9]{1,10}", suffix):
        return suffix

    known = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/heic": ".heic",
        "video/mp4": ".mp4",
        "video/quicktime": ".mov",
        "video/webm": ".webm",
    }

    return known.get(str(content_type).lower(), "")


def normalize_login(value):
    return str(
        value or ""
    ).strip().lower()


def clean_text(value, max_length):
    return str(
        value or ""
    ).strip()[:max_length]




FOUR_P_COMMENT_PREFIX = "[[TRT4P:"
FOUR_P_COMMENT_SUFFIX = "]]"
FOUR_P_PRICE_STATUS = "Нет данных / не оценивается"
MOSCOW_TIMEZONE = timezone(timedelta(hours=3))
MAX_VISIT_RESULTS = 12


def four_p_score(value):
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None

    if 1 <= number <= 5:
        return number

    return None


def four_p_integer(value):
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None

    return number


def four_p_float(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None

    if not math.isfinite(number):
        return None

    return number


def four_p_assortment_score(sku_count):
    if sku_count is None or sku_count < 0:
        return None
    if sku_count < 300:
        return 1
    if sku_count < 800:
        return 2
    if sku_count < 1500:
        return 3
    if sku_count < 3000:
        return 4
    return 5


def four_p_vog_share_score(share_percent):
    if share_percent is None or share_percent < 0 or share_percent > 100:
        return None
    if share_percent <= 5:
        return 1
    if share_percent <= 10:
        return 2
    if share_percent < 20:
        return 3
    if share_percent < 30:
        return 4
    return 5


def four_p_seller_motivation_score(participation_percent):
    if participation_percent is None or participation_percent < 0 or participation_percent > 100:
        return None
    if participation_percent <= 0:
        return 1
    if participation_percent <= 25:
        return 2
    if participation_percent <= 50:
        return 3
    if participation_percent <= 75:
        return 4
    return 5


def four_p_average(values):
    numbers = [float(value) for value in values if value is not None]
    if not numbers:
        return None
    return sum(numbers) / len(numbers)


def normalize_four_p_assessment(value):
    if value in (None, ""):
        return None

    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError as error:
            raise ValueError("Некорректный формат оценки 4P.") from error

    if not isinstance(value, dict):
        raise ValueError("Поле fourP должно быть JSON-объектом.")

    place = value.get("place") or {}
    product = value.get("product") or {}
    promotion = value.get("promotion") or {}
    if not all(isinstance(item, dict) for item in (place, product, promotion)):
        raise ValueError("Разделы оценки ТРТ должны быть JSON-объектами.")

    place_location = four_p_score(place.get("locationScore"))
    place_vog = four_p_score(place.get("vogPlacementScore"))

    sku_count = four_p_integer(product.get("skuCount"))
    vog_sku_count = four_p_integer(product.get("vogSkuCount"))
    legacy_share = four_p_float(product.get("vogSharePercent"))
    if sku_count is not None and sku_count > 0 and vog_sku_count is not None:
        vog_share = round(vog_sku_count / sku_count * 100, 1)
    else:
        vog_share = legacy_share

    assortment_score = four_p_assortment_score(sku_count)
    vog_share_score = four_p_vog_share_score(vog_share)

    commercial_terms = four_p_score(
        promotion.get("commercialTermsScore", promotion.get("ownerIncentiveScore"))
    )
    seller_count = four_p_integer(promotion.get("sellerCount"))
    vog_club_participants = four_p_integer(promotion.get("vogClubParticipants"))
    if seller_count is not None and seller_count > 0 and vog_club_participants is not None:
        seller_participation = round(vog_club_participants / seller_count * 100, 1)
        seller_motivation = four_p_seller_motivation_score(seller_participation)
    else:
        seller_participation = None
        seller_motivation = four_p_score(promotion.get("sellerMotivationScore"))
    consumer_promo = four_p_score(promotion.get("consumerPromoScore"))

    required_scores = (
        place_location,
        place_vog,
        assortment_score,
        vog_share_score,
        seller_motivation,
        consumer_promo,
    )
    if any(score is None for score in required_scores):
        raise ValueError(
            "Рейтинг ТРТ заполнен не полностью. Проверьте ручные оценки, ассортимент и мотивацию."
        )

    if sku_count is None or sku_count <= 0:
        raise ValueError("Общее количество SKU должно быть больше нуля.")
    if vog_sku_count is not None and (vog_sku_count < 0 or vog_sku_count > sku_count):
        raise ValueError("Количество SKU ВОГ указано некорректно.")
    if seller_count is not None and seller_count <= 0:
        raise ValueError("Общее количество продавцов должно быть больше нуля.")
    if vog_club_participants is not None and seller_count is not None and (
        vog_club_participants < 0 or vog_club_participants > seller_count
    ):
        raise ValueError("Количество участников VOG Club указано некорректно.")

    place_score = four_p_average([place_location, place_vog])
    product_score = four_p_average([assortment_score, vog_share_score])
    promotion_score = four_p_average([
        commercial_terms,
        seller_motivation,
        consumer_promo,
    ])
    total_score = four_p_average([place_score, product_score, promotion_score])

    assessed_at = clean_text(value.get("assessedAt"), 100)
    return {
        "version": 2,
        "complete": True,
        "place": {
            "locationScore": place_location,
            "vogPlacementScore": place_vog,
            "score": round(place_score, 4),
        },
        "product": {
            "skuCount": sku_count,
            "assortmentScore": assortment_score,
            "vogSkuCount": vog_sku_count,
            "vogSharePercent": round(vog_share, 1),
            "vogShareScore": vog_share_score,
            "outdatedSamples": bool(product.get("outdatedSamples")),
            "score": round(product_score, 4),
        },
        "promotion": {
            "commercialTermsScore": commercial_terms,
            "commercialTermsStatus": (
                "Получено из системы" if commercial_terms is not None else "Ожидает данных КУ"
            ),
            "sellerCount": seller_count,
            "vogClubParticipants": vog_club_participants,
            "sellerParticipationPercent": seller_participation,
            "sellerMotivationScore": seller_motivation,
            "consumerPromoScore": consumer_promo,
            "score": round(promotion_score, 4),
        },
        "price": {"status": FOUR_P_PRICE_STATUS},
        "totalScore": round(total_score, 4),
        "assessedAt": assessed_at or None,
    }


def normalize_visit_result_details(
    results,
    other_result,
    fallback_result="",
):
    normalized = []
    source = results if isinstance(results, list) else []

    for item in source:
        value = clean_text(item, 300)
        if value and value not in normalized:
            normalized.append(value)
        if len(normalized) >= MAX_VISIT_RESULTS:
            break

    other = clean_text(other_result, 500)

    if not normalized and not other:
        fallback = clean_text(fallback_result, 1000)
        if fallback:
            normalized.append(fallback)

    return {
        "items": normalized,
        "otherResult": other,
    }


def visit_result_display(result_details):
    if not isinstance(result_details, dict):
        return ""

    values = [
        clean_text(item, 300)
        for item in result_details.get("items", [])
        if clean_text(item, 300)
    ]

    other = clean_text(
        result_details.get("otherResult"),
        500,
    )

    if other:
        values.append(other)

    return " • ".join(values)[:1000]


def encode_visit_comment(
    comment,
    four_p,
    result_details=None,
):
    human_comment = clean_text(
        comment,
        10_000,
    )

    if four_p is None and result_details is None:
        return human_comment

    payload_object = {
        "schema": "visit-meta-v2",
        "fourP": four_p,
        "resultDetails": result_details,
    }

    payload = json.dumps(
        payload_object,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")

    encoded = base64.urlsafe_b64encode(
        payload
    ).decode("ascii").rstrip("=")

    marker = (
        FOUR_P_COMMENT_PREFIX
        + encoded
        + FOUR_P_COMMENT_SUFFIX
    )

    available = max(
        0,
        10_000 - len(marker) - 2,
    )

    human_comment = human_comment[
        :available
    ]

    if human_comment:
        return (
            human_comment
            + "\n\n"
            + marker
        )

    return marker


def decode_visit_comment(value):
    raw = str(value or "")
    pattern = re.compile(
        r"(?:\n\n)?\[\[TRT4P:"
        r"([A-Za-z0-9_-]+)"
        r"\]\]\s*$"
    )
    match = pattern.search(raw)

    if match is None:
        return raw.strip(), None, None

    encoded = match.group(1)
    padding = "=" * (
        (-len(encoded)) % 4
    )

    try:
        payload = (
            base64.urlsafe_b64decode(
                encoded + padding
            ).decode("utf-8")
        )
        decoded = json.loads(payload)
    except (
        ValueError,
        UnicodeDecodeError,
        binascii.Error,
    ):
        return raw.strip(), None, None

    four_p = None
    result_details = None

    if isinstance(decoded, dict) and decoded.get("schema") == "visit-meta-v2":
        four_p = decoded.get("fourP")
        result_details = decoded.get("resultDetails")
    else:
        # Старые визиты: в маркере находился непосредственно объект 4P.
        four_p = decoded

    public_comment = raw[
        :match.start()
    ].strip()

    return public_comment, four_p, result_details


def moscow_date_key(value):
    if value is None:
        return ""

    if isinstance(value, datetime):
        current = value
        if current.tzinfo is None:
            current = current.replace(tzinfo=timezone.utc)
        else:
            current = current.astimezone(timezone.utc)
    elif isinstance(value, int):
        current = datetime.fromtimestamp(
            value / 1_000_000,
            tz=timezone.utc,
        )
    else:
        try:
            current = datetime.fromisoformat(
                str(value).replace("Z", "+00:00")
            )
        except ValueError:
            return ""
        if current.tzinfo is None:
            current = current.replace(tzinfo=timezone.utc)

    return current.astimezone(
        MOSCOW_TIMEZONE
    ).strftime("%Y-%m-%d")


def clean_identifier(value, max_length=200):
    result = clean_text(
        value,
        max_length,
    )

    if not result:
        return ""

    return result


def parse_iso_timestamp(value):
    raw_value = clean_text(
        value,
        100,
    )

    if not raw_value:
        current = datetime.now(
            timezone.utc
        )
    else:
        normalized = raw_value

        if normalized.endswith("Z"):
            normalized = (
                normalized[:-1]
                + "+00:00"
            )

        try:
            current = datetime.fromisoformat(
                normalized
            )
        except ValueError as error:
            raise ValueError(
                "Некорректная дата и время."
            ) from error

        if current.tzinfo is None:
            current = current.replace(
                tzinfo=timezone.utc
            )
        else:
            current = current.astimezone(
                timezone.utc
            )

    if (
        current.year < 1970
        or current.year > 2105
    ):
        raise ValueError(
            "Дата выходит за диапазон Timestamp."
        )

    epoch = datetime(
        1970,
        1,
        1,
        tzinfo=timezone.utc,
    )

    delta = current - epoch

    return (
        delta.days
        * 86_400
        * 1_000_000
        + delta.seconds
        * 1_000_000
        + delta.microseconds
    )


def timestamp_to_iso(value):
    if value is None:
        return None

    if isinstance(value, datetime):
        current = value

        if current.tzinfo is None:
            current = current.replace(
                tzinfo=timezone.utc
            )
        else:
            current = current.astimezone(
                timezone.utc
            )

        return (
            current.isoformat(
                timespec="milliseconds"
            )
            .replace(
                "+00:00",
                "Z",
            )
        )

    if isinstance(value, int):
        current = datetime.fromtimestamp(
            value / 1_000_000,
            tz=timezone.utc,
        )

        return (
            current.isoformat(
                timespec="milliseconds"
            )
            .replace(
                "+00:00",
                "Z",
            )
        )

    return str(value)


def parse_optional_float(
    value,
    minimum,
    maximum,
):
    if value is None or value == "":
        return None

    try:
        number = float(value)
    except (TypeError, ValueError):
        return None

    if not math.isfinite(number):
        return None

    if (
        number < minimum
        or number > maximum
    ):
        return None

    return number


def parse_distance_meters(data):
    direct_value = data.get(
        "distanceMeters"
    )

    if (
        direct_value is None
        or direct_value == ""
    ):
        direct_value = data.get(
            "distance_meters"
        )

    if (
        direct_value is not None
        and direct_value != ""
    ):
        try:
            distance = round(
                float(direct_value)
            )
        except (TypeError, ValueError):
            return None
    else:
        kilometers = data.get(
            "distanceKm"
        )

        if (
            kilometers is None
            or kilometers == ""
        ):
            return None

        try:
            distance = round(
                float(kilometers)
                * 1000
            )
        except (TypeError, ValueError):
            return None

    if distance < 0:
        return None

    return min(
        int(distance),
        4_294_967_295,
    )


def parse_optional_iso_timestamp(value):
    raw_value = clean_text(
        value,
        100,
    )

    if not raw_value:
        return None

    return parse_iso_timestamp(raw_value)


def parse_due_date(value):
    raw_value = clean_text(
        value,
        20,
    )

    if not raw_value:
        return None

    try:
        current = datetime.strptime(
            raw_value,
            "%Y-%m-%d",
        ).replace(
            hour=12,
            tzinfo=timezone.utc,
        )
    except ValueError as error:
        raise ValueError(
            "Некорректный срок задачи."
        ) from error

    return parse_iso_timestamp(
        current.isoformat()
    )


def parse_task_version(value):
    try:
        version = int(value or 1)
    except (TypeError, ValueError) as error:
        raise ValueError(
            "Некорректная версия задачи."
        ) from error

    if version < 1 or version > 18_446_744_073_709_551_615:
        raise ValueError(
            "Версия задачи выходит за допустимый диапазон."
        )

    return version


def normalize_task_priority(value):
    priority = clean_text(
        value,
        50,
    )

    if priority not in {
        "Низкий",
        "Средний",
        "Высокий",
    }:
        return "Средний"

    return priority


def normalize_task_status(value):
    status = clean_text(
        value,
        50,
    ).lower()

    if status not in {"open", "done"}:
        return "open"

    return status


def verify_password(
    password,
    password_salt,
    password_hash,
    password_algorithm,
):
    if (
        password_algorithm
        != "pbkdf2_sha256_310000"
    ):
        return False

    try:
        salt_bytes = base64.b64decode(
            password_salt
        )

        expected_hash = base64.b64decode(
            password_hash
        )
    except Exception:
        return False

    actual_hash = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt_bytes,
        PASSWORD_ITERATIONS,
    )

    return hmac.compare_digest(
        actual_hash,
        expected_hash,
    )


def create_password_hash(password):
    salt_bytes = secrets.token_bytes(16)
    password_hash = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt_bytes,
        PASSWORD_ITERATIONS,
    )
    return (
        base64.b64encode(salt_bytes).decode("ascii"),
        base64.b64encode(password_hash).decode("ascii"),
        "pbkdf2_sha256_310000",
    )


def generate_employee_id():
    return "employee-" + secrets.token_hex(6)


def hash_session_token(session_token):
    return hashlib.sha256(
        session_token.encode("utf-8")
    ).hexdigest()


def extract_session_token(
    data,
    request_event,
):
    direct_token = str(
        data.get("session_token") or ""
    ).strip()

    if direct_token:
        return direct_token

    authorization = get_header(
        request_event,
        "authorization",
    ).strip()

    parts = authorization.split(
        None,
        1,
    )

    if (
        len(parts) != 2
        or parts[0].lower() != "bearer"
    ):
        return ""

    return parts[1].strip()


def health():
    result_sets = execute_query(
        """
        SELECT 1 AS result;
        """
    )

    result_value = (
        result_sets[0].rows[0].result
    )

    return json_response(
        200,
        {
            "ydb_connected": True,
            "result": result_value,
            "api_version": API_VERSION,
            "access_model_version": (
                load_access_config()["payload"].get(
                    "version",
                    "",
                )
            ),
            "media_configured": all(
                os.environ.get(name)
                for name in (
                    "AWS_ACCESS_KEY_ID",
                    "AWS_SECRET_ACCESS_KEY",
                    "S3_ENDPOINT",
                    "S3_BUCKET",
                )
            ),
        },
    )


def read_active_session(session_token):
    session_token_hash = (
        hash_session_token(
            session_token
        )
    )

    result = execute_query(
        """
        DECLARE $session_token_hash AS Utf8;

        SELECT
            session_token_hash,
            employee_id,
            login
        FROM user_sessions
        WHERE
            session_token_hash =
                $session_token_hash
            AND revoked_at IS NULL
            AND expires_at >
                CurrentUtcTimestamp();
        """,
        {
            "$session_token_hash": utf8(
                session_token_hash
            ),
        },
    )

    rows = result[0].rows

    if not rows:
        return None

    return rows[0]


def read_active_user(
    employee_id,
    login,
):
    account_result = execute_query(
        """
        DECLARE $login AS Utf8;
        DECLARE $employee_id AS Utf8;

        SELECT
            login,
            employee_id,
            is_active
        FROM app_users
        WHERE
            login = $login
            AND employee_id =
                $employee_id;
        """,
        {
            "$login": utf8(login),
            "$employee_id": utf8(
                employee_id
            ),
        },
    )

    account_rows = (
        account_result[0].rows
    )

    if not account_rows:
        return None, None

    account = account_rows[0]

    employee_result = execute_query(
        """
        DECLARE $employee_id AS Utf8;

        SELECT
            employee_id,
            full_name,
            `role` AS user_role,
            is_active
        FROM employees
        WHERE employee_id =
            $employee_id;
        """,
        {
            "$employee_id": utf8(
                employee_id
            ),
        },
    )

    employee_rows = (
        employee_result[0].rows
    )

    if not employee_rows:
        return account, None

    return account, employee_rows[0]


def read_authenticated_context(
    data,
    request_event,
):
    session_token = extract_session_token(
        data,
        request_event,
    )

    if not session_token:
        return None, json_response(
            401,
            {
                "error": (
                    "Не передан токен "
                    "сессии."
                )
            },
        )

    session = read_active_session(
        session_token
    )

    if session is None:
        return None, json_response(
            401,
            {
                "error": (
                    "Сессия недействительна "
                    "или истекла."
                )
            },
        )

    account, employee = read_active_user(
        employee_id=session.employee_id,
        login=session.login,
    )

    if (
        account is None
        or employee is None
        or not account.is_active
        or not employee.is_active
    ):
        return None, json_response(
            403,
            {
                "error": (
                    "Учётная запись "
                    "или карточка сотрудника "
                    "отключена."
                )
            },
        )

    execute_query(
        """
        DECLARE $session_token_hash
            AS Utf8;

        UPDATE user_sessions
        SET
            last_seen_at =
                CurrentUtcTimestamp()
        WHERE session_token_hash =
            $session_token_hash;
        """,
        {
            "$session_token_hash": utf8(
                session.session_token_hash
            ),
        },
    )

    context = {
        "session": session,
        "account": account,
        "employee": employee,
    }
    context["access"] = resolve_access_profile(
        employee.employee_id,
        employee.full_name,
        session.login,
        employee.user_role,
    )
    return context, None


def login_user(
    data,
    request_event,
):
    login = normalize_login(
        data.get("login")
    )

    password = str(
        data.get("password") or ""
    )

    if not login or not password:
        return json_response(
            400,
            {
                "error": (
                    "Укажите логин и пароль."
                )
            },
        )

    user_result = execute_query(
        """
        DECLARE $login AS Utf8;

        SELECT
            login,
            employee_id,
            password_salt,
            password_hash,
            password_algorithm,
            is_active,
            failed_attempts
        FROM app_users
        WHERE login = $login;
        """,
        {
            "$login": utf8(login),
        },
    )

    user_rows = user_result[0].rows

    if not user_rows:
        return json_response(
            401,
            {
                "error": (
                    "Неверный логин "
                    "или пароль."
                )
            },
        )

    user = user_rows[0]

    if not user.is_active:
        return json_response(
            403,
            {
                "error": (
                    "Учётная запись "
                    "отключена."
                )
            },
        )

    password_is_valid = verify_password(
        password=password,
        password_salt=(
            user.password_salt
        ),
        password_hash=(
            user.password_hash
        ),
        password_algorithm=(
            user.password_algorithm
        ),
    )

    if not password_is_valid:
        new_failed_attempts = min(
            int(user.failed_attempts) + 1,
            4_294_967_295,
        )

        execute_query(
            """
            DECLARE $login AS Utf8;
            DECLARE $failed_attempts
                AS Uint32;

            UPDATE app_users
            SET
                failed_attempts =
                    $failed_attempts,
                updated_at =
                    CurrentUtcTimestamp()
            WHERE login = $login;
            """,
            {
                "$login": utf8(login),
                "$failed_attempts": uint32(
                    new_failed_attempts
                ),
            },
        )

        return json_response(
            401,
            {
                "error": (
                    "Неверный логин "
                    "или пароль."
                )
            },
        )

    employee_result = execute_query(
        """
        DECLARE $employee_id AS Utf8;

        SELECT
            employee_id,
            full_name,
            `role` AS user_role,
            is_active
        FROM employees
        WHERE employee_id =
            $employee_id;
        """,
        {
            "$employee_id": utf8(
                user.employee_id
            ),
        },
    )

    employee_rows = (
        employee_result[0].rows
    )

    if not employee_rows:
        return json_response(
            403,
            {
                "error": (
                    "Карточка сотрудника "
                    "не найдена."
                )
            },
        )

    employee = employee_rows[0]

    if not employee.is_active:
        return json_response(
            403,
            {
                "error": (
                    "Карточка сотрудника "
                    "отключена."
                )
            },
        )

    session_token = secrets.token_urlsafe(
        32
    )

    session_token_hash = hash_session_token(
        session_token
    )

    device_name = str(
        data.get("device_name") or ""
    ).strip()[:200]

    user_agent = get_header(
        request_event,
        "user-agent",
    )[:1000]

    execute_query(
        """
        DECLARE $session_token_hash
            AS Utf8;
        DECLARE $employee_id AS Utf8;
        DECLARE $login AS Utf8;
        DECLARE $device_name AS Utf8;
        DECLARE $user_agent AS Utf8;

        $now = CurrentUtcTimestamp();

        $expires_at = Unwrap(
            $now + Interval("P7D"),
            "Не удалось рассчитать срок сессии"
        );

        UPSERT INTO user_sessions (
            session_token_hash,
            employee_id,
            login,
            created_at,
            expires_at,
            last_seen_at,
            device_name,
            user_agent
        )
        VALUES (
            $session_token_hash,
            $employee_id,
            $login,
            $now,
            $expires_at,
            $now,
            $device_name,
            $user_agent
        );
        """,
        {
            "$session_token_hash": utf8(
                session_token_hash
            ),
            "$employee_id": utf8(
                user.employee_id
            ),
            "$login": utf8(login),
            "$device_name": utf8(
                device_name
            ),
            "$user_agent": utf8(
                user_agent
            ),
        },
    )

    execute_query(
        """
        DECLARE $login AS Utf8;

        UPDATE app_users
        SET
            failed_attempts = 0u,
            updated_at =
                CurrentUtcTimestamp()
        WHERE login = $login;
        """,
        {
            "$login": utf8(login),
        },
    )

    return json_response(
        200,
        {
            "authenticated": True,
            "session_token": session_token,
            "expires_in_seconds": 604800,
            "user": access_user_payload(
                employee,
                login,
            ),
        },
    )


def current_user(
    data,
    request_event,
):
    context, error_response = (
        read_authenticated_context(
            data,
            request_event,
        )
    )

    if error_response is not None:
        return error_response

    session = context["session"]
    employee = context["employee"]

    return json_response(
        200,
        {
            "authenticated": True,
            "user": access_user_payload(
                employee,
                session.login,
            ),
        },
    )


def logout_user(
    data,
    request_event,
):
    session_token = extract_session_token(
        data,
        request_event,
    )

    if not session_token:
        return json_response(
            401,
            {
                "error": (
                    "Не передан токен "
                    "сессии."
                )
            },
        )

    session = read_active_session(
        session_token
    )

    if session is None:
        return json_response(
            401,
            {
                "error": (
                    "Сессия недействительна "
                    "или уже завершена."
                )
            },
        )

    execute_query(
        """
        DECLARE $session_token_hash
            AS Utf8;

        UPDATE user_sessions
        SET
            revoked_at =
                CurrentUtcTimestamp(),
            last_seen_at =
                CurrentUtcTimestamp()
        WHERE session_token_hash =
            $session_token_hash;
        """,
        {
            "$session_token_hash": utf8(
                session.session_token_hash
            ),
        },
    )

    return json_response(
        200,
        {
            "logged_out": True,
        },
    )


def sync_visits(
    data,
    request_event,
):
    context, error_response = (
        read_authenticated_context(
            data,
            request_event,
        )
    )

    if error_response is not None:
        return error_response

    items = data.get("visits")

    if items is None:
        items = data.get("items")

    if not isinstance(items, list):
        return json_response(
            400,
            {
                "error": (
                    "Поле visits должно "
                    "быть массивом."
                )
            },
        )

    if len(items) > MAX_VISITS_PER_SYNC:
        return json_response(
            400,
            {
                "error": (
                    "За один запрос можно "
                    f"передать не более "
                    f"{MAX_VISITS_PER_SYNC} "
                    "визитов."
                )
            },
        )

    employee_id = (
        context["employee"].employee_id
    )

    synced_ids = []
    rejected = []

    for index, item in enumerate(items):
        if not isinstance(item, dict):
            rejected.append(
                {
                    "index": index,
                    "error": (
                        "Элемент должен быть "
                        "JSON-объектом."
                    ),
                }
            )
            continue

        visit_id = clean_identifier(
            item.get("id")
            or item.get("visit_id")
        )

        point_id = clean_identifier(
            item.get("trtId")
            or item.get("point_id")
        )

        if not visit_id or not point_id:
            rejected.append(
                {
                    "index": index,
                    "id": visit_id or None,
                    "error": (
                        "Не заполнены id "
                        "или trtId."
                    ),
                }
            )
            continue

        if not access_can_write_point(
            context["access"],
            point_id,
        ):
            rejected.append(
                {
                    "index": index,
                    "id": visit_id,
                    "error": (
                        "Нет доступа к этой ТРТ."
                    ),
                }
            )
            continue

        try:
            created_at_value = (
                parse_iso_timestamp(
                    item.get("createdAt")
                    or item.get("created_at")
                )
            )
        except ValueError as error:
            rejected.append(
                {
                    "index": index,
                    "id": visit_id,
                    "error": str(error),
                }
            )
            continue

        latitude = parse_optional_float(
            item.get("latitude"),
            -90,
            90,
        )

        longitude = parse_optional_float(
            item.get("longitude"),
            -180,
            180,
        )

        distance_meters = (
            parse_distance_meters(item)
        )

        result_details = normalize_visit_result_details(
            item.get("results"),
            item.get("otherResult")
            or item.get("other_result"),
            item.get("result"),
        )
        result = visit_result_display(
            result_details
        )

        if not result:
            rejected.append(
                {
                    "index": index,
                    "id": visit_id,
                    "error": (
                        "Выберите хотя бы один "
                        "результат визита."
                    ),
                }
            )
            continue

        comment = clean_text(
            item.get("comment"),
            10_000,
        )

        try:
            four_p = normalize_four_p_assessment(
                item.get("fourP")
                or item.get("four_p")
            )
        except ValueError as error:
            rejected.append(
                {
                    "index": index,
                    "id": visit_id,
                    "error": str(error),
                }
            )
            continue

        stored_comment = encode_visit_comment(
            comment,
            four_p,
            result_details,
        )

        next_action = clean_text(
            item.get("nextStep")
            or item.get("next_action"),
            5000,
        )

        existing_sets = execute_query(
            """
            DECLARE $visit_id AS Utf8;

            SELECT
                employee_id,
                created_at
            FROM visits
            WHERE visit_id = $visit_id
            LIMIT 1;
            """,
            {
                "$visit_id": utf8(
                    visit_id
                ),
            },
        )

        existing_rows = existing_sets[0].rows
        if existing_rows:
            existing_visit = existing_rows[0]
            if str(existing_visit.employee_id) != str(employee_id):
                rejected.append(
                    {
                        "index": index,
                        "id": visit_id,
                        "error": (
                            "Нельзя изменять визит "
                            "другого сотрудника."
                        ),
                    }
                )
                continue

            today_moscow = datetime.now(
                MOSCOW_TIMEZONE
            ).strftime("%Y-%m-%d")

            if moscow_date_key(
                existing_visit.created_at
            ) != today_moscow:
                rejected.append(
                    {
                        "index": index,
                        "id": visit_id,
                        "error": (
                            "Исправления невозможны. "
                            "Создайте новый визит"
                        ),
                    }
                )
                continue

            created_at_value = parse_iso_timestamp(
                timestamp_to_iso(
                    existing_visit.created_at
                )
            )

        execute_query(
            """
            DECLARE $visit_id AS Utf8;
            DECLARE $point_id AS Utf8;
            DECLARE $employee_id AS Utf8;
            DECLARE $started_at AS Timestamp;
            DECLARE $completed_at AS Timestamp;
            DECLARE $status AS Utf8;
            DECLARE $result AS Utf8;
            DECLARE $comment AS Utf8;
            DECLARE $next_action AS Utf8;
            DECLARE $latitude AS Double?;
            DECLARE $longitude AS Double?;
            DECLARE $distance_meters
                AS Uint32?;
            DECLARE $created_at AS Timestamp;

            UPSERT INTO visits (
                visit_id,
                point_id,
                employee_id,
                started_at,
                completed_at,
                status,
                result,
                comment,
                next_action,
                latitude,
                longitude,
                distance_meters,
                created_at,
                updated_at
            )
            VALUES (
                $visit_id,
                $point_id,
                $employee_id,
                $started_at,
                $completed_at,
                $status,
                $result,
                $comment,
                $next_action,
                $latitude,
                $longitude,
                $distance_meters,
                $created_at,
                CurrentUtcTimestamp()
            );
            """,
            {
                "$visit_id": utf8(
                    visit_id
                ),
                "$point_id": utf8(
                    point_id
                ),
                "$employee_id": utf8(
                    employee_id
                ),
                "$started_at": timestamp(
                    created_at_value
                ),
                "$completed_at": timestamp(
                    created_at_value
                ),
                "$status": utf8(
                    "completed"
                ),
                "$result": utf8(result),
                "$comment": utf8(
                    stored_comment
                ),
                "$next_action": utf8(
                    next_action
                ),
                "$latitude": optional_double(
                    latitude
                ),
                "$longitude": optional_double(
                    longitude
                ),
                "$distance_meters": (
                    optional_uint32(
                        distance_meters
                    )
                ),
                "$created_at": timestamp(
                    created_at_value
                ),
            },
        )

        synced_ids.append(visit_id)

    return json_response(
        200,
        {
            "synced": len(synced_ids),
            "visit_ids": synced_ids,
            "rejected": rejected,
        },
    )



def list_visits(
    data,
    request_event,
):
    context, error_response = (
        read_authenticated_context(
            data,
            request_event,
        )
    )

    if error_response is not None:
        return error_response

    profile = access_profile_for_context(
        context
    )

    result_sets = execute_query(
        """
        SELECT
            visit_id,
            point_id,
            employee_id,
            started_at,
            completed_at,
            status,
            result,
            comment,
            next_action,
            latitude,
            longitude,
            distance_meters,
            created_at,
            updated_at
        FROM visits
        ORDER BY created_at DESC
        LIMIT 5000;
        """
    )

    employee_sets = execute_query(
        """
        SELECT
            employee_id,
            full_name
        FROM employees;
        """
    )

    names_by_id = {
        str(row.employee_id): str(
            row.full_name
        )
        for row in employee_sets[0].rows
    }

    for item in load_access_config()[
        "employees"
    ]:
        names_by_id.setdefault(
            str(item["employeeId"]),
            str(item.get("fullName") or ""),
        )

    result_items = []

    for row in result_sets[0].rows:
        if not access_can_view_point_id(
            profile,
            row.point_id,
        ):
            continue

        distance_km = None

        if row.distance_meters is not None:
            distance_km = (
                float(row.distance_meters)
                / 1000
            )

        row_employee_id = str(
            row.employee_id
        )

        public_comment, four_p, result_details = (
            decode_visit_comment(
                row.comment or ""
            )
        )

        result_items.append(
            {
                "id": row.visit_id,
                "trtId": row.point_id,
                "employeeId": row_employee_id,
                "employee": names_by_id.get(
                    row_employee_id,
                    row_employee_id,
                ),
                "createdAt": (
                    timestamp_to_iso(
                        row.created_at
                    )
                ),
                "startedAt": (
                    timestamp_to_iso(
                        row.started_at
                    )
                ),
                "completedAt": (
                    timestamp_to_iso(
                        row.completed_at
                    )
                ),
                "status": row.status,
                "result": row.result or "",
                "results": (
                    result_details.get(
                        "items",
                        [],
                    )
                    if isinstance(
                        result_details,
                        dict,
                    )
                    else (
                        [row.result]
                        if row.result
                        else []
                    )
                ),
                "otherResult": (
                    result_details.get(
                        "otherResult",
                        "",
                    )
                    if isinstance(
                        result_details,
                        dict,
                    )
                    else ""
                ),
                "comment": public_comment,
                "fourP": four_p,
                "nextStep": (
                    row.next_action or ""
                ),
                "latitude": row.latitude,
                "longitude": row.longitude,
                "distanceMeters": (
                    row.distance_meters
                ),
                "distanceKm": distance_km,
                "updatedAt": (
                    timestamp_to_iso(
                        row.updated_at
                    )
                ),
            }
        )

    return json_response(
        200,
        {
            "visits": result_items,
            "count": len(result_items),
            "access": {
                "role": profile["accessRole"],
                "direction": profile["direction"],
            },
        },
    )


def read_task(task_id):
    result_sets = execute_query(
        """
        DECLARE $task_id AS Utf8;

        SELECT
            task_id,
            point_id,
            direction,
            assignee_id,
            created_by_id,
            title,
            description,
            completion_comment,
            priority,
            status,
            due_at,
            completed_at,
            version,
            created_at,
            updated_at
        FROM tasks
        WHERE task_id = $task_id;
        """,
        {
            "$task_id": utf8(task_id),
        },
    )

    rows = result_sets[0].rows
    return rows[0] if rows else None



def task_is_accessible(
    task,
    context,
):
    if task is None:
        return True

    if is_general_director(context):
        return True

    employee_id = str(
        context["employee"].employee_id
    )

    return (
        str(task.assignee_id) == employee_id
        or str(task.created_by_id) == employee_id
    )


def sync_tasks(
    data,
    request_event,
):
    context, error_response = (
        read_authenticated_context(
            data,
            request_event,
        )
    )

    if error_response is not None:
        return error_response

    items = data.get("tasks")

    if items is None:
        items = data.get("items")

    if not isinstance(items, list):
        return json_response(
            400,
            {
                "error": (
                    "Поле tasks должно "
                    "быть массивом."
                )
            },
        )

    if len(items) > MAX_TASKS_PER_SYNC:
        return json_response(
            400,
            {
                "error": (
                    "За один запрос можно "
                    f"передать не более "
                    f"{MAX_TASKS_PER_SYNC} "
                    "задач."
                )
            },
        )

    employee = context["employee"]
    employee_id = str(employee.employee_id)
    accepted_ids = []
    deleted_ids = []
    rejected = []

    for index, item in enumerate(items):
        if not isinstance(item, dict):
            rejected.append(
                {
                    "index": index,
                    "error": (
                        "Элемент должен быть "
                        "JSON-объектом."
                    ),
                }
            )
            continue

        task_id = clean_identifier(
            item.get("id")
            or item.get("task_id")
        )

        if not task_id:
            rejected.append(
                {
                    "index": index,
                    "error": (
                        "Не заполнен id задачи."
                    ),
                }
            )
            continue

        try:
            incoming_version = (
                parse_task_version(
                    item.get("version")
                )
            )
        except ValueError as error:
            rejected.append(
                {
                    "index": index,
                    "id": task_id,
                    "error": str(error),
                }
            )
            continue

        existing = read_task(task_id)

        if not task_is_accessible(
            existing,
            context,
        ):
            rejected.append(
                {
                    "index": index,
                    "id": task_id,
                    "error": (
                        "Нет доступа к задаче."
                    ),
                }
            )
            continue

        if (
            existing is not None
            and incoming_version
            < int(existing.version)
        ):
            rejected.append(
                {
                    "index": index,
                    "id": task_id,
                    "error": (
                        "На сервере есть более "
                        "новая версия задачи."
                    ),
                    "server_version": int(
                        existing.version
                    ),
                }
            )
            continue

        is_deleted = bool(
            item.get("deleted")
            or item.get("deletedAt")
            or item.get("deleted_at")
        )

        if is_deleted:
            rejected.append(
                {
                    "index": index,
                    "id": task_id,
                    "error": (
                        "Удаление задач запрещено. "
                        "Задачу можно только выполнить "
                        "с обязательным комментарием."
                    ),
                }
            )
            continue

        title = clean_text(
            item.get("title"),
            1000,
        )

        if not title:
            rejected.append(
                {
                    "index": index,
                    "id": task_id,
                    "error": (
                        "Не заполнено название "
                        "задачи."
                    ),
                }
            )
            continue

        point_id = clean_identifier(
            item.get("trtId")
            or item.get("point_id")
        ) or None

        if (
            not point_id
            or not access_can_write_point(
                context["access"],
                point_id,
            )
        ):
            rejected.append(
                {
                    "index": index,
                    "id": task_id,
                    "error": (
                        "Нет доступа к этой ТРТ."
                    ),
                }
            )
            continue

        direction = clean_text(
            item.get("direction"),
            500,
        ) or None

        description = clean_text(
            item.get("description"),
            10_000,
        )

        completion_comment = clean_text(
            item.get("completionComment")
            or item.get("completion_comment"),
            10_000,
        )

        priority = normalize_task_priority(
            item.get("priority")
        )

        status = normalize_task_status(
            item.get("status")
        )

        try:
            due_at_value = parse_due_date(
                item.get("dueDate")
                or item.get("due_at")
            )

            completed_at_value = (
                parse_optional_iso_timestamp(
                    item.get("completedAt")
                    or item.get("completed_at")
                )
            )

            incoming_created_at = (
                parse_iso_timestamp(
                    item.get("createdAt")
                    or item.get("created_at")
                )
            )
        except ValueError as error:
            rejected.append(
                {
                    "index": index,
                    "id": task_id,
                    "error": str(error),
                }
            )
            continue

        if status == "done":
            existing_is_done = (
                existing is not None
                and str(existing.status) == "done"
            )

            if not completion_comment and not existing_is_done:
                rejected.append(
                    {
                        "index": index,
                        "id": task_id,
                        "error": (
                            "Для выполнения задачи "
                            "обязателен комментарий."
                        ),
                    }
                )
                continue

            if completed_at_value is None:
                completed_at_value = (
                    parse_iso_timestamp(None)
                )
        else:
            completed_at_value = None
            completion_comment = ""

        if existing is not None:
            created_by_id = str(
                existing.created_by_id
            )
            created_at_value = (
                parse_iso_timestamp(
                    timestamp_to_iso(
                        existing.created_at
                    )
                )
            )
        else:
            created_by_id = employee_id
            created_at_value = (
                incoming_created_at
            )

        execute_query(
            """
            DECLARE $task_id AS Utf8;
            DECLARE $point_id AS Utf8?;
            DECLARE $direction AS Utf8?;
            DECLARE $assignee_id AS Utf8;
            DECLARE $created_by_id AS Utf8;
            DECLARE $title AS Utf8;
            DECLARE $description AS Utf8;
            DECLARE $completion_comment AS Utf8;
            DECLARE $priority AS Utf8;
            DECLARE $status AS Utf8;
            DECLARE $due_at AS Timestamp?;
            DECLARE $completed_at AS Timestamp?;
            DECLARE $version AS Uint64;
            DECLARE $created_at AS Timestamp;

            UPSERT INTO tasks (
                task_id,
                point_id,
                direction,
                assignee_id,
                created_by_id,
                title,
                description,
                completion_comment,
                priority,
                status,
                due_at,
                completed_at,
                version,
                created_at,
                updated_at
            )
            VALUES (
                $task_id,
                $point_id,
                $direction,
                $assignee_id,
                $created_by_id,
                $title,
                $description,
                $completion_comment,
                $priority,
                $status,
                $due_at,
                $completed_at,
                $version,
                $created_at,
                CurrentUtcTimestamp()
            );
            """,
            {
                "$task_id": utf8(task_id),
                "$point_id": optional_utf8(
                    point_id
                ),
                "$direction": optional_utf8(
                    direction
                ),
                "$assignee_id": utf8(
                    employee_id
                ),
                "$created_by_id": utf8(
                    created_by_id
                ),
                "$title": utf8(title),
                "$description": utf8(
                    description
                ),
                "$completion_comment": utf8(
                    completion_comment
                ),
                "$priority": utf8(priority),
                "$status": utf8(status),
                "$due_at": optional_timestamp(
                    due_at_value
                ),
                "$completed_at": (
                    optional_timestamp(
                        completed_at_value
                    )
                ),
                "$version": uint64(
                    incoming_version
                ),
                "$created_at": timestamp(
                    created_at_value
                ),
            },
        )

        accepted_ids.append(task_id)

    return json_response(
        200,
        {
            "synced": len(accepted_ids),
            "task_ids": accepted_ids,
            "deleted_ids": deleted_ids,
            "rejected": rejected,
        },
    )



def list_tasks(
    data,
    request_event,
):
    context, error_response = (
        read_authenticated_context(
            data,
            request_event,
        )
    )

    if error_response is not None:
        return error_response

    profile = access_profile_for_context(
        context
    )

    result_sets = execute_query(
        """
        SELECT
            task_id,
            point_id,
            direction,
            assignee_id,
            created_by_id,
            title,
            description,
            completion_comment,
            priority,
            status,
            due_at,
            completed_at,
            version,
            created_at,
            updated_at
        FROM tasks
        ORDER BY updated_at DESC,
            created_at DESC
        LIMIT 5000;
        """
    )

    employee_sets = execute_query(
        """
        SELECT
            employee_id,
            full_name
        FROM employees
        WHERE is_active = true;
        """
    )

    names_by_id = {
        str(row.employee_id): str(
            row.full_name
        )
        for row in employee_sets[0].rows
    }

    for item in load_access_config()[
        "employees"
    ]:
        names_by_id.setdefault(
            str(item["employeeId"]),
            str(item.get("fullName") or ""),
        )

    result_items = []

    for row in result_sets[0].rows:
        point_id = str(
            row.point_id or ""
        )

        if point_id:
            if not access_can_view_point_id(
                profile,
                point_id,
            ):
                continue
        elif not (
            is_general_director(context)
            or str(row.assignee_id)
            == str(
                context["employee"].employee_id
            )
            or str(row.created_by_id)
            == str(
                context["employee"].employee_id
            )
        ):
            continue

        due_date = None

        if row.due_at is not None:
            due_date = timestamp_to_iso(
                row.due_at
            )[:10]

        result_items.append(
            {
                "id": row.task_id,
                "trtId": row.point_id,
                "direction": (
                    row.direction or ""
                ),
                "assigneeId": (
                    row.assignee_id
                ),
                "createdById": (
                    row.created_by_id
                ),
                "assignee": names_by_id.get(
                    str(row.assignee_id),
                    str(row.assignee_id),
                ),
                "createdBy": names_by_id.get(
                    str(row.created_by_id),
                    str(row.created_by_id),
                ),
                "title": row.title,
                "description": (
                    row.description or ""
                ),
                "completionComment": (
                    row.completion_comment
                    or ""
                ),
                "priority": row.priority,
                "status": row.status,
                "dueDate": due_date or "",
                "completedAt": (
                    timestamp_to_iso(
                        row.completed_at
                    )
                ),
                "version": int(row.version),
                "createdAt": (
                    timestamp_to_iso(
                        row.created_at
                    )
                ),
                "updatedAt": (
                    timestamp_to_iso(
                        row.updated_at
                    )
                ),
            }
        )

    return json_response(
        200,
        {
            "tasks": result_items,
            "count": len(result_items),
            "access": {
                "role": profile["accessRole"],
                "direction": profile["direction"],
            },
        },
    )



def media_user_is_admin(context):
    return is_general_director(context)


def ensure_point_exists(point_id):
    result = execute_query(
        """
        DECLARE $point_id AS Utf8;

        SELECT point_id
        FROM trt_points
        WHERE
            point_id = $point_id
            AND is_active = true;
        """,
        {
            "$point_id": utf8(point_id),
        },
    )

    return bool(result[0].rows)



def validate_media_scope(
    point_id,
    visit_id,
    task_id,
    context,
    write_access=False,
):
    if visit_id and task_id:
        return False, (
            "Файл нельзя одновременно "
            "привязать к визиту и задаче."
        )

    profile = access_profile_for_context(
        context
    )

    if not access_can_view_point_id(
        profile,
        point_id,
    ):
        return False, (
            "Нет доступа к этой ТРТ."
        )

    employee_id = str(
        context["employee"].employee_id
    )
    is_gd = is_general_director(
        context
    )

    if visit_id:
        result = execute_query(
            """
            DECLARE $visit_id AS Utf8;

            SELECT
                point_id,
                employee_id
            FROM visits
            WHERE visit_id = $visit_id;
            """,
            {
                "$visit_id": utf8(visit_id),
            },
        )

        if not result[0].rows:
            return False, "Визит не найден."

        visit = result[0].rows[0]

        if str(visit.point_id) != point_id:
            return False, (
                "Визит относится к другой ТРТ."
            )

        if (
            write_access
            and not is_gd
            and str(visit.employee_id)
            != employee_id
        ):
            return False, (
                "Добавлять материалы можно "
                "только в свой визит."
            )

    if task_id:
        result = execute_query(
            """
            DECLARE $task_id AS Utf8;

            SELECT
                point_id,
                assignee_id,
                created_by_id
            FROM tasks
            WHERE task_id = $task_id;
            """,
            {
                "$task_id": utf8(task_id),
            },
        )

        if not result[0].rows:
            return False, "Задача не найдена."

        task = result[0].rows[0]

        if str(task.point_id or "") != point_id:
            return False, (
                "Задача относится к другой ТРТ."
            )

        participant_ids = {
            str(task.assignee_id),
            str(task.created_by_id),
        }

        if (
            write_access
            and not is_gd
            and employee_id not in participant_ids
        ):
            return False, (
                "Добавлять материалы можно "
                "только в свою задачу."
            )

    return True, ""


def create_download_url(object_key):
    return get_s3_client().generate_presigned_url(
        "get_object",
        Params={
            "Bucket": s3_bucket_name(),
            "Key": object_key,
        },
        ExpiresIn=MEDIA_DOWNLOAD_URL_TTL,
        HttpMethod="GET",
    )


def media_thumbnail_object_key(row):
    identity = "|".join(
        [
            str(row.media_id),
            str(row.object_key),
            str(row.etag or ""),
        ]
    )
    digest = hashlib.sha256(
        identity.encode("utf-8")
    ).hexdigest()
    return (
        "thumbnails/"
        + digest[:2]
        + "/"
        + digest
        + ".jpg"
    )


def create_thumbnail_url(object_key):
    return get_s3_client().generate_presigned_url(
        "get_object",
        Params={
            "Bucket": s3_bucket_name(),
            "Key": object_key,
        },
        ExpiresIn=MEDIA_DOWNLOAD_URL_TTL,
        HttpMethod="GET",
    )


def ensure_media_thumbnail(row):
    content_type = str(
        row.content_type or ""
    ).lower()

    if not content_type.startswith("image/"):
        return None, False

    thumbnail_key = media_thumbnail_object_key(row)
    s3 = get_s3_client()

    try:
        s3.head_object(
            Bucket=s3_bucket_name(),
            Key=thumbnail_key,
        )
        return thumbnail_key, True
    except ClientError as error:
        error_code = str(
            error.response.get("Error", {}).get(
                "Code", ""
            )
        )
        if error_code not in {
            "404",
            "NoSuchKey",
            "NotFound",
        }:
            raise

    source_size = int(row.size_bytes or 0)
    if (
        source_size <= 0
        or source_size
        > MEDIA_THUMBNAIL_MAX_SOURCE_SIZE
    ):
        return None, False

    source = s3.get_object(
        Bucket=s3_bucket_name(),
        Key=row.object_key,
    )
    raw = source["Body"].read(
        MEDIA_THUMBNAIL_MAX_SOURCE_SIZE + 1
    )

    if len(raw) > MEDIA_THUMBNAIL_MAX_SOURCE_SIZE:
        return None, False

    try:
        with Image.open(BytesIO(raw)) as opened:
            image = ImageOps.exif_transpose(opened)
            image.thumbnail(
                (
                    MEDIA_THUMBNAIL_MAX_EDGE,
                    MEDIA_THUMBNAIL_MAX_EDGE,
                ),
                Image.Resampling.LANCZOS,
            )

            if image.mode in {"RGBA", "LA"}:
                background = Image.new(
                    "RGB",
                    image.size,
                    "white",
                )
                alpha = image.getchannel("A")
                background.paste(
                    image.convert("RGB"),
                    mask=alpha,
                )
                image = background
            elif image.mode != "RGB":
                image = image.convert("RGB")

            output = BytesIO()
            image.save(
                output,
                format="JPEG",
                quality=MEDIA_THUMBNAIL_QUALITY,
                optimize=True,
                progressive=True,
            )
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
    ):
        return None, False

    output.seek(0)
    s3.put_object(
        Bucket=s3_bucket_name(),
        Key=thumbnail_key,
        Body=output.getvalue(),
        ContentType="image/jpeg",
        CacheControl=(
            "private, max-age=31536000, immutable"
        ),
    )

    return thumbnail_key, True


def get_media_row(media_id):
    result = execute_query(
        """
        DECLARE $media_id AS Utf8;

        SELECT
            media_id,
            point_id,
            visit_id,
            task_id,
            employee_id,
            object_key,
            file_name,
            content_type,
            media_kind,
            purpose,
            size_bytes,
            status,
            etag,
            created_at,
            updated_at
        FROM media_files
        WHERE media_id = $media_id;
        """,
        {
            "$media_id": utf8(media_id),
        },
    )
    if not result[0].rows:
        return None
    return result[0].rows[0]


def create_media_thumbnail_url(
    data,
    request_event,
):
    context, error_response = (
        read_authenticated_context(
            data,
            request_event,
        )
    )

    if error_response is not None:
        return error_response

    media_id = clean_identifier(
        data.get("mediaId")
        or data.get("media_id")
        or data.get("id")
    )

    if not media_id:
        return json_response(
            400,
            {"error": "Не указан media_id."},
        )

    row = get_media_row(media_id)
    if row is None or str(row.status) != "uploaded":
        return json_response(
            404,
            {"error": "Файл не найден."},
        )

    employee_id = str(
        context["employee"].employee_id
    )
    is_admin = media_user_is_admin(context)
    allowed, access_error = validate_media_scope(
        str(row.point_id or ""),
        str(row.visit_id or ""),
        str(row.task_id or ""),
        context,
        write_access=False,
    )

    if not allowed:
        return json_response(
            403,
            {"error": access_error},
        )

    thumbnail_key, generated = (
        ensure_media_thumbnail(row)
    )

    if thumbnail_key:
        return json_response(
            200,
            {
                "mediaId": media_id,
                "thumbnailUrl": (
                    create_thumbnail_url(
                        thumbnail_key
                    )
                ),
                "downloadUrl": (
                    create_download_url(
                        row.object_key
                    )
                ),
                "generated": generated,
                "fallbackOriginal": False,
                "expiresIn": (
                    MEDIA_DOWNLOAD_URL_TTL
                ),
            },
        )

    return json_response(
        200,
        {
            "mediaId": media_id,
            "thumbnailUrl": (
                create_download_url(
                    row.object_key
                )
            ),
            "downloadUrl": (
                create_download_url(
                    row.object_key
                )
            ),
            "generated": False,
            "fallbackOriginal": True,
            "expiresIn": MEDIA_DOWNLOAD_URL_TTL,
        },
    )


def media_row_to_json(row, include_url=True):
    result = {
        "id": row.media_id,
        "trtId": row.point_id,
        "visitId": row.visit_id,
        "taskId": row.task_id,
        "employeeId": row.employee_id,
        "objectKey": row.object_key,
        "name": row.file_name,
        "type": row.content_type,
        "mediaKind": row.media_kind,
        "purpose": (
            row.purpose
            or (
                "task_result"
                if row.task_id
                else "visit"
                if row.visit_id
                else "point"
            )
        ),
        "size": int(row.size_bytes),
        "status": row.status,
        "etag": row.etag or "",
        "createdAt": timestamp_to_iso(
            row.created_at
        ),
        "updatedAt": timestamp_to_iso(
            row.updated_at
        ),
    }

    if include_url and row.status == "uploaded":
        result["downloadUrl"] = (
            create_download_url(row.object_key)
        )
        result["downloadUrlExpiresIn"] = (
            MEDIA_DOWNLOAD_URL_TTL
        )

    return result


def create_media_upload_url(
    data,
    request_event,
):
    context, error_response = (
        read_authenticated_context(
            data,
            request_event,
        )
    )

    if error_response is not None:
        return error_response

    media_id = clean_identifier(
        data.get("id")
        or data.get("media_id")
    )
    point_id = clean_identifier(
        data.get("trtId")
        or data.get("point_id")
    )
    visit_id = clean_identifier(
        data.get("visitId")
        or data.get("visit_id")
    )
    task_id = clean_identifier(
        data.get("taskId")
        or data.get("task_id")
    )
    purpose = clean_text(
        data.get("purpose"),
        50,
    ).lower()
    file_name = clean_text(
        data.get("name")
        or data.get("file_name"),
        255,
    )
    content_type = clean_text(
        data.get("type")
        or data.get("content_type"),
        200,
    ).lower()

    try:
        size_bytes = int(
            data.get("size")
            or data.get("size_bytes")
            or 0
        )
    except (TypeError, ValueError):
        size_bytes = 0

    if not media_id or not point_id:
        return json_response(
            400,
            {
                "error": (
                    "Не заполнены id файла "
                    "или идентификатор ТРТ."
                )
            },
        )

    if not file_name:
        return json_response(
            400,
            {"error": "Не указано имя файла."},
        )

    if not (
        content_type.startswith("image/")
        or content_type.startswith("video/")
    ):
        return json_response(
            400,
            {
                "error": (
                    "Разрешены только фото "
                    "и видео."
                )
            },
        )

    if (
        size_bytes <= 0
        or size_bytes > MAX_MEDIA_FILE_SIZE
    ):
        return json_response(
            400,
            {
                "error": (
                    "Размер файла должен быть "
                    "от 1 байта до 80 МБ."
                )
            },
        )

    if not ensure_point_exists(point_id):
        return json_response(
            404,
            {"error": "ТРТ не найдена."},
        )

    employee_id = str(
        context["employee"].employee_id
    )
    is_admin = media_user_is_admin(context)

    scope_is_valid, scope_error = (
        validate_media_scope(
            point_id=point_id,
            visit_id=visit_id,
            task_id=task_id,
            context=context,
            write_access=True,
        )
    )

    if not scope_is_valid:
        return json_response(
            403,
            {"error": scope_error},
        )

    if not purpose:
        purpose = (
            "task_result"
            if task_id
            else "visit"
            if visit_id
            else "point"
        )

    allowed_purposes = {
        "point",
        "visit",
        "task_material",
        "task_result",
    }

    if purpose not in allowed_purposes:
        return json_response(
            400,
            {"error": "Некорректное назначение файла."},
        )

    if task_id and purpose not in {
        "task_material",
        "task_result",
    }:
        return json_response(
            400,
            {"error": "Для задачи указан неверный тип материала."},
        )

    if visit_id and purpose != "visit":
        return json_response(
            400,
            {"error": "Для визита указан неверный тип материала."},
        )

    if not task_id and not visit_id and purpose != "point":
        return json_response(
            400,
            {"error": "Для ТРТ указан неверный тип материала."},
        )

    existing_result = execute_query(
        """
        DECLARE $media_id AS Utf8;

        SELECT
            media_id,
            point_id,
            visit_id,
            task_id,
            employee_id,
            object_key,
            file_name,
            content_type,
            media_kind,
            purpose,
            size_bytes,
            status,
            etag,
            created_at,
            updated_at
        FROM media_files
        WHERE media_id = $media_id;
        """,
        {
            "$media_id": utf8(media_id),
        },
    )

    existing_rows = existing_result[0].rows

    if existing_rows:
        existing = existing_rows[0]

        if (
            not is_admin
            and str(existing.employee_id)
            != employee_id
        ):
            return json_response(
                403,
                {
                    "error": (
                        "Этот идентификатор файла "
                        "уже принадлежит другому "
                        "сотруднику."
                    )
                },
            )

        if existing.status == "uploaded":
            return json_response(
                200,
                {
                    "already_uploaded": True,
                    "media": media_row_to_json(
                        existing,
                        include_url=True,
                    ),
                },
            )

        object_key = str(existing.object_key)
    else:
        if task_id:
            scope_name = "tasks"
            scope_id = task_id
        elif visit_id:
            scope_name = "visits"
            scope_id = visit_id
        else:
            scope_name = "points"
            scope_id = point_id

        object_key = "/".join(
            (
                "points",
                safe_object_segment(point_id),
                scope_name,
                safe_object_segment(scope_id),
                safe_object_segment(media_id)
                + media_extension(
                    file_name,
                    content_type,
                ),
            )
        )

    media_kind = (
        "photo"
        if content_type.startswith("image/")
        else "video"
    )

    execute_query(
        """
        DECLARE $media_id AS Utf8;
        DECLARE $point_id AS Utf8;
        DECLARE $visit_id AS Utf8?;
        DECLARE $task_id AS Utf8?;
        DECLARE $employee_id AS Utf8;
        DECLARE $object_key AS Utf8;
        DECLARE $file_name AS Utf8;
        DECLARE $content_type AS Utf8;
        DECLARE $media_kind AS Utf8;
        DECLARE $purpose AS Utf8;
        DECLARE $size_bytes AS Uint64;
        DECLARE $status AS Utf8;

        UPSERT INTO media_files (
            media_id,
            point_id,
            visit_id,
            task_id,
            employee_id,
            object_key,
            file_name,
            content_type,
            media_kind,
            purpose,
            size_bytes,
            status,
            created_at,
            updated_at
        )
        VALUES (
            $media_id,
            $point_id,
            $visit_id,
            $task_id,
            $employee_id,
            $object_key,
            $file_name,
            $content_type,
            $media_kind,
            $purpose,
            $size_bytes,
            $status,
            CurrentUtcTimestamp(),
            CurrentUtcTimestamp()
        );
        """,
        {
            "$media_id": utf8(media_id),
            "$point_id": utf8(point_id),
            "$visit_id": optional_utf8(
                visit_id or None
            ),
            "$task_id": optional_utf8(
                task_id or None
            ),
            "$employee_id": utf8(
                employee_id
            ),
            "$object_key": utf8(object_key),
            "$file_name": utf8(file_name),
            "$content_type": utf8(
                content_type
            ),
            "$media_kind": utf8(media_kind),
            "$purpose": utf8(purpose),
            "$size_bytes": uint64(
                size_bytes
            ),
            "$status": utf8("pending"),
        },
    )

    upload_url = (
        get_s3_client().generate_presigned_url(
            "put_object",
            Params={
                "Bucket": s3_bucket_name(),
                "Key": object_key,
                "ContentType": content_type,
            },
            ExpiresIn=MEDIA_UPLOAD_URL_TTL,
            HttpMethod="PUT",
        )
    )

    return json_response(
        200,
        {
            "media_id": media_id,
            "object_key": object_key,
            "upload_url": upload_url,
            "expires_in_seconds": (
                MEDIA_UPLOAD_URL_TTL
            ),
            "headers": {
                "Content-Type": content_type,
            },
        },
    )


def complete_media_upload(
    data,
    request_event,
):
    context, error_response = (
        read_authenticated_context(
            data,
            request_event,
        )
    )

    if error_response is not None:
        return error_response

    media_id = clean_identifier(
        data.get("mediaId")
        or data.get("media_id")
        or data.get("id")
    )

    if not media_id:
        return json_response(
            400,
            {"error": "Не указан media_id."},
        )

    result = execute_query(
        """
        DECLARE $media_id AS Utf8;

        SELECT
            media_id,
            point_id,
            visit_id,
            task_id,
            employee_id,
            object_key,
            file_name,
            content_type,
            media_kind,
            purpose,
            size_bytes,
            status,
            etag,
            created_at,
            updated_at
        FROM media_files
        WHERE media_id = $media_id;
        """,
        {
            "$media_id": utf8(media_id),
        },
    )

    if not result[0].rows:
        return json_response(
            404,
            {"error": "Файл не найден."},
        )

    row = result[0].rows[0]
    employee_id = str(
        context["employee"].employee_id
    )
    is_admin = media_user_is_admin(context)

    if (
        not is_admin
        and str(row.employee_id)
        != employee_id
    ):
        return json_response(
            403,
            {"error": "Нет доступа к файлу."},
        )

    try:
        object_info = get_s3_client().head_object(
            Bucket=s3_bucket_name(),
            Key=row.object_key,
        )
    except ClientError as error:
        error_code = str(
            error.response.get("Error", {}).get(
                "Code", ""
            )
        )

        if error_code in {
            "404",
            "NoSuchKey",
            "NotFound",
        }:
            return json_response(
                409,
                {
                    "error": (
                        "Файл ещё не загружен "
                        "в Object Storage."
                    )
                },
            )

        raise

    actual_size = int(
        object_info.get("ContentLength") or 0
    )
    actual_type = clean_text(
        object_info.get("ContentType")
        or row.content_type,
        200,
    ).lower()
    etag = clean_text(
        str(object_info.get("ETag") or "")
        .strip('"'),
        300,
    )

    if (
        actual_size <= 0
        or actual_size > MAX_MEDIA_FILE_SIZE
    ):
        return json_response(
            400,
            {
                "error": (
                    "Загруженный файл имеет "
                    "недопустимый размер."
                )
            },
        )

    if not (
        actual_type.startswith("image/")
        or actual_type.startswith("video/")
    ):
        return json_response(
            400,
            {
                "error": (
                    "Загруженный объект не является "
                    "фото или видео."
                )
            },
        )

    execute_query(
        """
        DECLARE $media_id AS Utf8;
        DECLARE $size_bytes AS Uint64;
        DECLARE $content_type AS Utf8;
        DECLARE $media_kind AS Utf8;
        DECLARE $etag AS Utf8;

        UPDATE media_files
        SET
            size_bytes = $size_bytes,
            content_type = $content_type,
            media_kind = $media_kind,
            status = "uploaded",
            etag = $etag,
            updated_at = CurrentUtcTimestamp()
        WHERE media_id = $media_id;
        """,
        {
            "$media_id": utf8(media_id),
            "$size_bytes": uint64(
                actual_size
            ),
            "$content_type": utf8(
                actual_type
            ),
            "$media_kind": utf8(
                "photo"
                if actual_type.startswith("image/")
                else "video"
            ),
            "$etag": utf8(etag),
        },
    )

    updated = execute_query(
        """
        DECLARE $media_id AS Utf8;

        SELECT
            media_id,
            point_id,
            visit_id,
            task_id,
            employee_id,
            object_key,
            file_name,
            content_type,
            media_kind,
            purpose,
            size_bytes,
            status,
            etag,
            created_at,
            updated_at
        FROM media_files
        WHERE media_id = $media_id;
        """,
        {
            "$media_id": utf8(media_id),
        },
    )[0].rows[0]

    return json_response(
        200,
        {
            "uploaded": True,
            "media": media_row_to_json(
                updated,
                include_url=True,
            ),
        },
    )



def list_media(
    data,
    request_event,
):
    context, error_response = (
        read_authenticated_context(
            data,
            request_event,
        )
    )

    if error_response is not None:
        return error_response

    profile = access_profile_for_context(
        context
    )

    result_sets = execute_query(
        f"""
        SELECT
            media_id,
            point_id,
            visit_id,
            task_id,
            employee_id,
            object_key,
            file_name,
            content_type,
            media_kind,
            purpose,
            size_bytes,
            status,
            etag,
            created_at,
            updated_at
        FROM media_files
        WHERE status = "uploaded"
        ORDER BY created_at DESC
        LIMIT {MAX_MEDIA_LIST};
        """
    )

    items = [
        media_row_to_json(
            row,
            include_url=True,
        )
        for row in result_sets[0].rows
        if access_can_view_point_id(
            profile,
            row.point_id,
        )
    ]

    return json_response(
        200,
        {
            "media": items,
            "count": len(items),
            "download_url_expires_in": (
                MEDIA_DOWNLOAD_URL_TTL
            ),
            "access": {
                "role": profile["accessRole"],
                "direction": profile["direction"],
            },
        },
    )


def employee_display_name(full_name):
    parts = clean_text(
        full_name,
        300,
    ).split()

    if len(parts) >= 2:
        return " ".join(parts[:2])

    return " ".join(parts)



def read_employee_profiles():
    account_sets = execute_query(
        """
        SELECT
            employee_id,
            login,
            is_active
        FROM app_users;
        """
    )

    account_by_employee = {
        str(row.employee_id): row
        for row in account_sets[0].rows
    }

    config = load_access_config()
    names_by_id = {
        str(item["employeeId"]): str(
            item.get("displayName")
            or employee_display_name(
                item.get("fullName")
            )
        )
        for item in config["employees"]
    }

    items = []

    for row in config["employees"]:
        employee_id = str(
            row["employeeId"]
        )
        manager_id = str(
            row.get("managerEmployeeId")
            or ""
        )
        account = account_by_employee.get(
            employee_id
        )

        items.append(
            {
                "employeeId": employee_id,
                "fullName": str(
                    row.get("fullName") or ""
                ),
                "displayName": str(
                    row.get("displayName")
                    or employee_display_name(
                        row.get("fullName")
                    )
                ),
                "position": str(
                    row.get("position") or ""
                ),
                "direction": str(
                    row.get("direction") or ""
                ),
                "managerId": manager_id,
                "managerName": names_by_id.get(
                    manager_id,
                    "",
                ),
                "role": str(
                    row.get("accessRole")
                    or "MANAGER"
                ),
                "roleLabel": str(
                    row.get("roleLabel")
                    or ACCESS_ROLE_LABELS.get(
                        str(
                            row.get("accessRole")
                            or "MANAGER"
                        ),
                        "",
                    )
                ),
                "email": str(
                    row.get("email") or ""
                ),
                "isActive": bool(
                    row.get("isActive", True)
                ),
                "hasAccount": (
                    account is not None
                ),
                "login": (
                    str(account.login)
                    if account is not None
                    else ""
                ),
                "accountActive": (
                    bool(account.is_active)
                    if account is not None
                    else False
                ),
                "createdAt": None,
                "updatedAt": None,
            }
        )

    return items




def generate_invitation_password(length=12):
    alphabet = (
        "ABCDEFGHJKLMNPQRSTUVWXYZ"
        "abcdefghijkmnopqrstuvwxyz"
        "23456789!@#"
    )
    return "".join(
        secrets.choice(alphabet)
        for _ in range(length)
    )



def invitation_message(
    employee_name,
    login,
    password,
):
    app_url = os.environ.get(
        "INVITE_APP_URL",
        "https://ra44973.github.io/trt-mobile/",
    ).strip()

    first_name = (
        clean_text(employee_name, 300).split()[1]
        if len(
            clean_text(
                employee_name,
                300,
            ).split()
        ) >= 2
        else clean_text(employee_name, 300)
    )

    subject = (
        "Приглашение в приложение "
        "«VOG Мобильный помощник»"
    )

    text = f"""Здравствуйте, {first_name}!

Вам открыт доступ к мобильному приложению «VOG Мобильный помощник».

Данные для входа:
Логин: {login}
Временный пароль: {password}

Адрес приложения:
{app_url}

Установка на Android:
1. Откройте ссылку в Google Chrome.
2. Нажмите меню ⋮.
3. Выберите «Установить приложение» или «Добавить на главный экран».
4. Откройте приложение с появившейся иконки.

Установка на iPhone:
1. Откройте ссылку именно в Safari.
2. Нажмите «Поделиться» — квадрат со стрелкой вверх.
3. Выберите «На экран Домой».
4. Включите «Открывать как веб-приложение».
5. Нажмите «Добавить» и откройте приложение с экрана iPhone.

При первом использовании разрешите доступ к геолокации, камере, фотографиям и микрофону.

Не пересылайте логин и пароль другим сотрудникам.
"""

    safe_name = html.escape(
        first_name
    )
    safe_login = html.escape(login)
    safe_password = html.escape(password)
    safe_url = html.escape(
        app_url,
        quote=True,
    )

    html_body = f"""<!doctype html>
<html lang="ru">
<body style="margin:0;background:#f4f6f5;font-family:Arial,sans-serif;color:#17202a">
  <div style="max-width:620px;margin:0 auto;padding:28px 16px">
    <div style="background:#ffffff;border-radius:20px;padding:28px">
      <h1 style="margin:0 0 16px;font-size:24px">VOG Мобильный помощник</h1>
      <p>Здравствуйте, {safe_name}!</p>
      <p>Вам открыт доступ к мобильному приложению для работы с ТРТ.</p>

      <div style="background:#edf6f2;border-radius:14px;padding:18px;margin:20px 0">
        <div style="font-size:13px;color:#667085">Логин</div>
        <div style="font-size:18px;font-weight:700;margin:4px 0 14px">{safe_login}</div>
        <div style="font-size:13px;color:#667085">Временный пароль</div>
        <div style="font-size:20px;font-weight:800;margin-top:4px">{safe_password}</div>
      </div>

      <p style="text-align:center;margin:24px 0">
        <a href="{safe_url}" style="display:block;box-sizing:border-box;max-width:340px;margin:0 auto;background:#39765f;color:#fff;text-decoration:none;padding:22px 24px;border-radius:12px;font-size:20px;line-height:1.2;font-weight:800;text-align:center">
          Установить приложение
        </a>
      </p>

      <h2 style="font-size:18px;margin-top:28px">Android</h2>
      <ol style="line-height:1.55">
        <li>Откройте ссылку в Google Chrome.</li>
        <li>Нажмите меню ⋮.</li>
        <li>Выберите «Установить приложение» или «Добавить на главный экран».</li>
        <li>Откройте приложение с появившейся иконки.</li>
      </ol>

      <h2 style="font-size:18px;margin-top:24px">iPhone</h2>
      <ol style="line-height:1.55">
        <li>Откройте ссылку именно в Safari.</li>
        <li>Нажмите «Поделиться» — квадрат со стрелкой вверх.</li>
        <li>Выберите «На экран Домой».</li>
        <li>Включите «Открывать как веб-приложение».</li>
        <li>Нажмите «Добавить».</li>
      </ol>

      <p style="margin-top:24px;color:#667085;font-size:13px">
        При первом использовании разрешите доступ к геолокации,
        камере, фотографиям и микрофону. Не пересылайте данные входа.
      </p>
    </div>
  </div>
</body>
</html>"""

    return subject, text, html_body


def send_yandex_smtp_email(
    recipient,
    subject,
    text_body,
    html_body,
):
    from_email = normalize_login(
        os.environ.get(
            "SMTP_FROM_EMAIL",
            "razguliaev.alex@yandex.ru",
        )
    )
    username = clean_text(
        os.environ.get(
            "SMTP_USERNAME",
            from_email,
        ),
        320,
    )
    app_password = str(
        os.environ.get(
            "SMTP_APP_PASSWORD",
            "",
        )
    ).strip()

    if not from_email:
        raise RuntimeError(
            "Не задан адрес отправителя "
            "SMTP_FROM_EMAIL."
        )

    if not username:
        raise RuntimeError(
            "Не задан логин SMTP_USERNAME."
        )

    if not app_password:
        raise RuntimeError(
            "В Cloud Function не задан "
            "пароль приложения "
            "SMTP_APP_PASSWORD."
        )

    # Для личного ящика @yandex.ru Яндекс
    # рекомендует использовать логин до знака @.
    smtp_login = username
    if username.lower().endswith(
        ("@yandex.ru", "@ya.ru")
    ):
        smtp_login = username.split(
            "@",
            1,
        )[0]

    message = EmailMessage()
    message["From"] = from_email
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(text_body)
    message.add_alternative(
        html_body,
        subtype="html",
    )

    context = ssl.create_default_context()

    try:
        with smtplib.SMTP_SSL(
            "smtp.yandex.ru",
            465,
            context=context,
            timeout=15,
        ) as smtp:
            smtp.login(
                smtp_login,
                app_password,
            )
            smtp.send_message(message)
    except smtplib.SMTPAuthenticationError as error:
        raise RuntimeError(
            "Яндекс Почта отклонила вход. "
            "Проверьте логин и пароль "
            "приложения."
        ) from error
    except (
        smtplib.SMTPException,
        OSError,
    ) as error:
        raise RuntimeError(
            "Не удалось отправить письмо "
            "через smtp.yandex.ru."
        ) from error

    return {
        "messageId": str(
            message.get("Message-ID") or ""
        ),
    }


def invite_employee(
    data,
    request_event,
):
    context, error_response = (
        read_authenticated_context(
            data,
            request_event,
        )
    )

    if error_response is not None:
        return error_response

    if not is_system_admin(context):
        return json_response(
            403,
            {
                "error": (
                    "Приглашать сотрудников может "
                    "только администратор системы."
                )
            },
        )

    employee_id = clean_text(
        data.get("employeeId")
        or data.get("employee_id"),
        100,
    )

    if not employee_id:
        return json_response(
            400,
            {
                "error": (
                    "Не указан сотрудник "
                    "для приглашения."
                )
            },
        )

    employee = next(
        (
            item
            for item in read_employee_profiles()
            if str(item.get("employeeId"))
            == employee_id
        ),
        None,
    )

    if employee is None:
        return json_response(
            404,
            {"error": "Сотрудник не найден."},
        )

    # Не включаем отключённых сотрудников автоматически.
    # Приглашение создаёт/активирует только учётную запись
    # уже активного сотрудника.
    if not bool(employee.get("isActive", True)):
        return json_response(
            409,
            {
                "error": (
                    "Сотрудник отключён. Сначала "
                    "активируйте его карточку."
                )
            },
        )

    employee_email = normalize_login(
        employee.get("email")
        or employee.get("login")
    )

    if not re.fullmatch(
        r"[^@\s]+@[^@\s]+\.[^@\s]+",
        employee_email,
    ):
        return json_response(
            409,
            {
                "error": (
                    "У сотрудника не указана "
                    "корректная электронная почта."
                )
            },
        )

    # Сначала ищем учётную запись по сотруднику. Так мы
    # сохраняем существующий логин, даже если почта в
    # справочнике позднее была изменена.
    account_result = execute_query(
        """
        DECLARE $employee_id AS Utf8;

        SELECT
            login,
            employee_id,
            password_salt,
            password_hash,
            password_algorithm,
            is_active,
            failed_attempts
        FROM app_users
        WHERE employee_id = $employee_id
        LIMIT 1;
        """,
        {
            "$employee_id": utf8(employee_id),
        },
    )
    account_rows = account_result[0].rows
    old_account = account_rows[0] if account_rows else None

    if old_account is None:
        login_conflict = execute_query(
            """
            DECLARE $login AS Utf8;

            SELECT
                login,
                employee_id
            FROM app_users
            WHERE login = $login
            LIMIT 1;
            """,
            {
                "$login": utf8(employee_email),
            },
        )[0].rows

        if (
            login_conflict
            and str(login_conflict[0].employee_id)
            != employee_id
        ):
            return json_response(
                409,
                {
                    "error": (
                        "Эта электронная почта уже "
                        "используется другой учётной "
                        "записью."
                    )
                },
            )

    login = normalize_login(
        old_account.login
        if old_account is not None
        else employee_email
    )
    recipient = employee_email
    account_created = old_account is None
    account_reactivated = bool(
        old_account is not None
        and not bool(old_account.is_active)
    )

    employee_result = execute_query(
        """
        DECLARE $employee_id AS Utf8;

        SELECT
            employee_id,
            full_name,
            `role` AS user_role,
            is_active
        FROM employees
        WHERE employee_id = $employee_id
        LIMIT 1;
        """,
        {
            "$employee_id": utf8(employee_id),
        },
    )
    employee_rows = employee_result[0].rows
    old_employee = employee_rows[0] if employee_rows else None
    employee_row_created = old_employee is None
    employee_reactivated = bool(
        old_employee is not None
        and not bool(old_employee.is_active)
    )

    temporary_password = generate_invitation_password()
    salt, password_hash, algorithm = (
        create_password_hash(
            temporary_password
        )
    )
    full_name = clean_text(
        employee.get("fullName")
        or employee.get("displayName")
        or employee_id,
        300,
    )

    try:
        if employee_row_created:
            # Роль и права администратора независимы.
            # Автоматически созданная запись никогда не
            # получает административные права.
            execute_query(
                """
                DECLARE $employee_id AS Utf8;
                DECLARE $full_name AS Utf8;

                UPSERT INTO employees (
                    employee_id,
                    full_name,
                    `role`,
                    is_active,
                    created_at
                ) VALUES (
                    $employee_id,
                    $full_name,
                    "employee",
                    true,
                    CurrentUtcTimestamp()
                );
                """,
                {
                    "$employee_id": utf8(employee_id),
                    "$full_name": utf8(full_name),
                },
            )
        elif employee_reactivated:
            execute_query(
                """
                DECLARE $employee_id AS Utf8;

                UPDATE employees
                SET is_active = true
                WHERE employee_id = $employee_id;
                """,
                {
                    "$employee_id": utf8(employee_id),
                },
            )

        if account_created:
            execute_query(
                """
                DECLARE $login AS Utf8;
                DECLARE $employee_id AS Utf8;
                DECLARE $password_salt AS Utf8;
                DECLARE $password_hash AS Utf8;
                DECLARE $password_algorithm AS Utf8;

                $now = CurrentUtcTimestamp();

                UPSERT INTO app_users (
                    login,
                    employee_id,
                    password_salt,
                    password_hash,
                    password_algorithm,
                    is_active,
                    failed_attempts,
                    created_at,
                    updated_at
                ) VALUES (
                    $login,
                    $employee_id,
                    $password_salt,
                    $password_hash,
                    $password_algorithm,
                    true,
                    0u,
                    $now,
                    $now
                );
                """,
                {
                    "$login": utf8(login),
                    "$employee_id": utf8(employee_id),
                    "$password_salt": utf8(salt),
                    "$password_hash": utf8(password_hash),
                    "$password_algorithm": utf8(algorithm),
                },
            )
        else:
            execute_query(
                """
                DECLARE $login AS Utf8;
                DECLARE $password_salt AS Utf8;
                DECLARE $password_hash AS Utf8;
                DECLARE $password_algorithm AS Utf8;

                UPDATE app_users
                SET
                    password_salt = $password_salt,
                    password_hash = $password_hash,
                    password_algorithm =
                        $password_algorithm,
                    is_active = true,
                    failed_attempts = 0u,
                    updated_at =
                        CurrentUtcTimestamp()
                WHERE login = $login;
                """,
                {
                    "$login": utf8(login),
                    "$password_salt": utf8(salt),
                    "$password_hash": utf8(password_hash),
                    "$password_algorithm": utf8(algorithm),
                },
            )

        # Рабочий режим: приглашение отправляется непосредственно сотруднику.
        # Переменная INVITE_TEST_RECIPIENT больше не переопределяет получателя.
        actual_recipient = recipient
        subject, text_body, html_body = (
            invitation_message(
                full_name,
                login,
                temporary_password,
            )
        )
        send_result = send_yandex_smtp_email(
            actual_recipient,
            subject,
            text_body,
            html_body,
        )
    except Exception as error:
        # При ошибке отправки возвращаем состояние до
        # приглашения, чтобы не оставить неизвестный пароль.
        try:
            if account_created:
                execute_query(
                    """
                    DECLARE $login AS Utf8;
                    DECLARE $employee_id AS Utf8;

                    DELETE FROM app_users
                    WHERE
                        login = $login
                        AND employee_id = $employee_id;
                    """,
                    {
                        "$login": utf8(login),
                        "$employee_id": utf8(employee_id),
                    },
                )
            else:
                execute_query(
                    """
                    DECLARE $login AS Utf8;
                    DECLARE $password_salt AS Utf8;
                    DECLARE $password_hash AS Utf8;
                    DECLARE $password_algorithm AS Utf8;
                    DECLARE $is_active AS Bool;
                    DECLARE $failed_attempts AS Uint32;

                    UPDATE app_users
                    SET
                        password_salt = $password_salt,
                        password_hash = $password_hash,
                        password_algorithm =
                            $password_algorithm,
                        is_active = $is_active,
                        failed_attempts = $failed_attempts,
                        updated_at =
                            CurrentUtcTimestamp()
                    WHERE login = $login;
                    """,
                    {
                        "$login": utf8(login),
                        "$password_salt": utf8(
                            str(old_account.password_salt)
                        ),
                        "$password_hash": utf8(
                            str(old_account.password_hash)
                        ),
                        "$password_algorithm": utf8(
                            str(old_account.password_algorithm)
                        ),
                        "$is_active": boolean(
                            bool(old_account.is_active)
                        ),
                        "$failed_attempts": uint32(
                            int(old_account.failed_attempts or 0)
                        ),
                    },
                )

            if employee_row_created:
                execute_query(
                    """
                    DECLARE $employee_id AS Utf8;

                    DELETE FROM employees
                    WHERE employee_id = $employee_id;
                    """,
                    {
                        "$employee_id": utf8(employee_id),
                    },
                )
            elif employee_reactivated:
                execute_query(
                    """
                    DECLARE $employee_id AS Utf8;

                    UPDATE employees
                    SET is_active = false
                    WHERE employee_id = $employee_id;
                    """,
                    {
                        "$employee_id": utf8(employee_id),
                    },
                )
        except Exception as rollback_error:
            print(
                "Invitation rollback warning:",
                repr(rollback_error),
            )

        return json_response(
            502,
            {
                "error": str(error),
                "password_changed": False,
                "account_created": False,
            },
        )

    try:
        execute_query(
            """
            DECLARE $employee_id AS Utf8;

            UPDATE user_sessions
            SET
                revoked_at =
                    CurrentUtcTimestamp()
            WHERE
                employee_id = $employee_id
                AND revoked_at IS NULL;
            """,
            {
                "$employee_id": utf8(employee_id),
            },
        )
    except Exception as error:
        print(
            "Session revoke warning:",
            repr(error),
        )

    invalidate_access_config_cache()

    return json_response(
        200,
        {
            "sent": True,
            "employeeId": employee_id,
            "employeeName": (
                employee.get("displayName")
                or employee.get("fullName")
            ),
            "login": login,
            "recipient": actual_recipient,
            "testMode": bool(test_recipient),
            "accountCreated": account_created,
            "accountReactivated": account_reactivated,
            "employeeRecordCreated": employee_row_created,
            "messageId": (
                send_result.get("MessageId")
                or send_result.get("messageId")
                or ""
            ),
        },
    )


def list_employees(
    data,
    request_event,
):
    context, error_response = (
        read_authenticated_context(
            data,
            request_event,
        )
    )

    if error_response is not None:
        return error_response

    if not is_system_admin(context):
        return json_response(
            403,
            {
                "error": (
                    "Справочник сотрудников доступен "
                    "только администратору системы."
                )
            },
        )

    profile = access_profile_for_context(
        context
    )

    items = read_employee_profiles()

    return json_response(
        200,
        {
            "employees": items,
            "count": len(items),
            "access": {
                "role": profile["accessRole"],
                "roleLabel": profile["roleLabel"],
                "direction": profile["direction"],
            },
        },
    )



def save_employee(
    data,
    request_event,
):
    context, error_response = (
        read_authenticated_context(
            data,
            request_event,
        )
    )

    if error_response is not None:
        return error_response

    if not is_system_admin(context):
        return json_response(
            403,
            {
                "error": (
                    "Добавлять сотрудников может "
                    "только администратор системы."
                )
            },
        )

    full_name = clean_text(
        data.get("fullName"),
        300,
    )
    role = clean_text(
        data.get("role"),
        30,
    ).upper()
    direction = clean_text(
        data.get("direction"),
        100,
    )
    manager_id = clean_text(
        data.get("managerId"),
        200,
    )
    login = normalize_login(
        data.get("email") or data.get("login")
    )
    password = str(
        data.get("password") or ""
    )
    is_active = bool(
        data.get("isActive", True)
    )

    if len(full_name.split()) < 2:
        return json_response(
            400,
            {"error": "Укажите полное ФИО сотрудника."},
        )

    if role not in {"GD", "KD", "RRO", "MANAGER"}:
        return json_response(
            400,
            {
                "error": (
                    "Выберите роль: ГД, КД, РРО "
                    "или Менеджер."
                )
            },
        )

    if role == "GD":
        # ГД видит все направления и не обязан иметь руководителя.
        # Административные права через эту форму не выдаются.
        direction = ""
        manager_id = ""
    else:
        if direction not in {"Плитка", "Обои"}:
            return json_response(
                400,
                {"error": "Выберите направление сотрудника."},
            )

        if not manager_id:
            return json_response(
                400,
                {"error": "Выберите непосредственного руководителя."},
            )

    if not re.fullmatch(
        r"[^@\s]+@[^@\s]+\.[^@\s]+",
        login,
    ):
        return json_response(
            400,
            {"error": "Укажите корректную корпоративную почту."},
        )

    if len(password) < 8 or len(password) > 128:
        return json_response(
            400,
            {
                "error": (
                    "Временный пароль должен содержать "
                    "от 8 до 128 символов."
                )
            },
        )

    config = load_access_config()
    manager = None
    manager_role = ""
    manager_direction = ""

    if role != "GD":
        manager = config["by_id"].get(manager_id)

        if manager is None or not bool(
            manager.get("isActive", True)
        ):
            return json_response(
                400,
                {"error": "Выбранный руководитель не найден или отключён."},
            )

        manager_role = str(
            manager.get("accessRole") or ""
        ).upper()
        manager_direction = str(
            manager.get("direction") or ""
        )

        if role == "KD" and manager_role != "GD":
            return json_response(
                400,
                {"error": "Коммерческий директор должен подчиняться ГД."},
            )

        if role == "RRO" and manager_role not in {"GD", "KD"}:
            return json_response(
                400,
                {"error": "РРО должен подчиняться ГД или КД."},
            )

        if role == "MANAGER" and manager_role not in {"GD", "KD", "RRO"}:
            return json_response(
                400,
                {"error": "Для менеджера выбран некорректный руководитель."},
            )

        if (
            manager_role != "GD"
            and manager_direction
            and manager_direction != direction
        ):
            return json_response(
                400,
                {
                    "error": (
                        "Направление сотрудника должно совпадать "
                        "с направлением руководителя."
                    )
                },
            )

    account_result = execute_query(
        """
        DECLARE $login AS Utf8;

        SELECT login, employee_id
        FROM app_users
        WHERE login = $login;
        """,
        {"$login": utf8(login)},
    )

    if account_result[0].rows:
        return json_response(
            409,
            {
                "error": (
                    "Учётная запись с такой почтой уже существует."
                )
            },
        )

    normalized_name = normalize_access_person_name(
        full_name
    )
    for item in config["employees"]:
        if normalize_access_person_name(
            item.get("fullName")
        ) == normalized_name:
            return json_response(
                409,
                {"error": "Сотрудник с таким ФИО уже существует."},
            )

    employee_id = generate_employee_id()
    display_name = employee_display_name(full_name)
    role_label = ACCESS_ROLE_LABELS[role]
    position = {
        "GD": "ГД",
        "KD": "КД",
        "RRO": "РРО",
        "MANAGER": "Менеджер",
    }[role]
    # Административный признак не выдаётся через интерфейс.
    # Поэтому даже новый ГД создаётся как обычная учётная запись.
    legacy_role = "employee"
    password_salt, password_hash, password_algorithm = (
        create_password_hash(password)
    )

    try:
        execute_query(
            """
            DECLARE $employee_id AS Utf8;
            DECLARE $full_name AS Utf8;
            DECLARE $display_name AS Utf8;
            DECLARE $position AS Utf8;
            DECLARE $access_role AS Utf8;
            DECLARE $role_label AS Utf8;
            DECLARE $direction AS Utf8;
            DECLARE $manager_id AS Utf8;
            DECLARE $email AS Utf8;
            DECLARE $legacy_role AS Utf8;
            DECLARE $is_active AS Bool;
            DECLARE $password_salt AS Utf8;
            DECLARE $password_hash AS Utf8;
            DECLARE $password_algorithm AS Utf8;

            $now = CurrentUtcTimestamp();

            UPSERT INTO employee_directory (
                employee_id,
                full_name,
                display_name,
                position,
                access_role,
                role_label,
                direction,
                manager_id,
                email,
                is_active,
                created_at,
                updated_at
            ) VALUES (
                $employee_id,
                $full_name,
                $display_name,
                $position,
                $access_role,
                $role_label,
                $direction,
                $manager_id,
                $email,
                $is_active,
                $now,
                $now
            );

            UPSERT INTO employees (
                employee_id,
                full_name,
                `role`,
                is_active,
                created_at
            ) VALUES (
                $employee_id,
                $full_name,
                $legacy_role,
                $is_active,
                $now
            );

            UPSERT INTO app_users (
                login,
                employee_id,
                password_salt,
                password_hash,
                password_algorithm,
                is_active,
                failed_attempts,
                created_at,
                updated_at
            ) VALUES (
                $email,
                $employee_id,
                $password_salt,
                $password_hash,
                $password_algorithm,
                $is_active,
                0u,
                $now,
                $now
            );
            """,
            {
                "$employee_id": utf8(employee_id),
                "$full_name": utf8(full_name),
                "$display_name": utf8(display_name),
                "$position": utf8(position),
                "$access_role": utf8(role),
                "$role_label": utf8(role_label),
                "$direction": utf8(direction),
                "$manager_id": utf8(manager_id),
                "$email": utf8(login),
                "$legacy_role": utf8(legacy_role),
                "$is_active": boolean(is_active),
                "$password_salt": utf8(password_salt),
                "$password_hash": utf8(password_hash),
                "$password_algorithm": utf8(password_algorithm),
            },
        )
    except Exception as error:
        error_text = str(error)
        if "employee_directory" in error_text:
            return json_response(
                500,
                {
                    "error": (
                        "Не создана таблица добавления сотрудников. "
                        "Сначала выполните SQL-файл из комплекта обновления."
                    )
                },
            )
        return json_response(
            500,
            {
                "error": (
                    "Не удалось создать сотрудника: "
                    + error_text[:500]
                ),
                "details": error_text[:1000],
            },
        )

    invalidate_access_config_cache()

    return json_response(
        201,
        {
            "created": True,
            "employee": {
                "employeeId": employee_id,
                "fullName": full_name,
                "displayName": display_name,
                "position": position,
                "role": role,
                "roleLabel": role_label,
                "direction": direction,
                "managerId": manager_id,
                "managerName": (
                    str(
                        manager.get("displayName")
                        or employee_display_name(
                            manager.get("fullName")
                        )
                    )
                    if manager is not None
                    else ""
                ),
                "email": login,
                "login": login,
                "isActive": is_active,
                "hasAccount": True,
                "accountActive": is_active,
            },
        },
    )




# ---------------------------------------------------------------------------
# Помесячные продажи ТРТ
# ---------------------------------------------------------------------------

SALES_MONTHS_RU = (
    "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
)
MAX_SALES_IMPORT_ROWS = 100_000
SALES_BATCH_SIZE = 80


def normalize_sales_text(value):
    value = str(value or "").strip().lower()
    value = value.replace("Ё", "Е").replace("ё", "е")
    value = re.sub(r"[^0-9A-Za-zА-Яа-я]+", " ", value)
    return " ".join(value.split())


def normalize_sales_direction(value):
    normalized = normalize_sales_text(value)
    if "обо" in normalized:
        return "обои"
    if (
        "плит" in normalized
        or "керам" in normalized
        or "керамогран" in normalized
    ):
        return "плитка"
    return normalized


def parse_sales_quantity(value):
    if isinstance(value, str):
        value = value.strip().replace(" ", "").replace(",", ".")
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or number < 0:
        return None
    return number


def sales_period_label(year, month):
    return f"{SALES_MONTHS_RU[int(month) - 1]} {int(year)}"


def validate_sales_period(year, month):
    try:
        year = int(year)
        month = int(month)
    except (TypeError, ValueError) as error:
        raise ValueError("Некорректный период загрузки.") from error

    if year < 2020 or year > 2100:
        raise ValueError("Некорректный год загрузки.")
    if month < 1 or month > 12:
        raise ValueError("Некорректный месяц загрузки.")
    return year, month


def sales_point_id(point):
    return str(
        point.get("id")
        or point.get("pointId")
        or point.get("point_id")
        or ""
    ).strip()


def sales_point_client_values(point):
    values = {
        normalize_sales_text(point.get("client")),
        normalize_sales_text(point.get("holding")),
        normalize_sales_text(point.get("customer")),
        normalize_sales_text(point.get("clientName")),
        normalize_sales_text(point.get("customerName")),
    }
    return {item for item in values if item}


def sales_point_location_values(point):
    clients = sales_point_client_values(point)
    locations = {
        normalize_sales_text(point.get("address")),
        normalize_sales_text(point.get("location")),
        normalize_sales_text(point.get("name")),
        normalize_sales_text(point.get("pointName")),
        normalize_sales_text(point.get("title")),
        normalize_sales_text(point.get("trtName")),
    }
    locations = {item for item in locations if item}
    combined = {
        normalize_sales_text(f"{client} {location}")
        for client in clients
        for location in locations
    }
    return clients | locations | combined


def sales_similarity(left, right):
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0

    left_tokens = set(left.split())
    right_tokens = set(right.split())
    token_score = (
        len(left_tokens & right_tokens)
        / max(1, len(left_tokens | right_tokens))
    )
    sequence_score = SequenceMatcher(None, left, right).ratio()
    contains_bonus = 0.04 if left in right or right in left else 0.0
    return min(1.0, max(token_score, sequence_score) + contains_bonus)


def build_sales_point_index(points):
    result = []
    for point in points:
        if not isinstance(point, dict):
            continue
        point_id = sales_point_id(point)
        if not point_id:
            continue
        result.append(
            {
                "point": point,
                "pointId": point_id,
                "direction": normalize_sales_direction(
                    point.get("direction")
                ),
                "clients": sales_point_client_values(point),
                "locations": sales_point_location_values(point),
            }
        )
    return result


def match_sales_row(row, point_index):
    direction = normalize_sales_direction(row.get("direction"))
    client = normalize_sales_text(row.get("client"))
    location = normalize_sales_text(row.get("location"))
    quantity = parse_sales_quantity(row.get("quantity"))

    if not direction:
        return "invalid", None, "Не заполнено направление деятельности"
    if not client:
        return "invalid", None, "Не заполнен клиент"
    if not location:
        return "invalid", None, "Не заполнена торговая точка / месторасположение"
    if quantity is None:
        return "invalid", None, "Количество должно быть числом не меньше нуля"

    candidates_by_direction = [
        item for item in point_index
        if item["direction"] == direction
    ]
    if not candidates_by_direction:
        return "unmatched", None, "В базе нет ТРТ этого направления"

    exact = []
    for item in candidates_by_direction:
        if client in item["clients"] and location in item["locations"]:
            exact.append(item)

    if len(exact) == 1:
        return "matched", exact[0]["pointId"], "Точное совпадение клиента и ТРТ"
    if len(exact) > 1:
        return "ambiguous", None, f"Найдено точных совпадений: {len(exact)}"

    similar = []
    for item in candidates_by_direction:
        client_score = max(
            (sales_similarity(client, value) for value in item["clients"]),
            default=0.0,
        )
        location_score = max(
            (sales_similarity(location, value) for value in item["locations"]),
            default=0.0,
        )
        score = 0.35 * client_score + 0.65 * location_score
        if client_score >= 0.78 and location_score >= 0.88:
            similar.append((score, item["pointId"]))

    similar.sort(reverse=True)
    if not similar:
        return "unmatched", None, "Совпадение с ТРТ не найдено"
    if len(similar) == 1 and similar[0][0] >= 0.91:
        return (
            "matched",
            similar[0][1],
            f"Консервативное сопоставление: {similar[0][0]:.0%}",
        )
    if (
        similar[0][0] >= 0.93
        and similar[0][0] - similar[1][0] >= 0.07
    ):
        return (
            "matched",
            similar[0][1],
            f"Консервативное сопоставление: {similar[0][0]:.0%}",
        )
    return (
        "ambiguous",
        None,
        "Найдено несколько похожих ТРТ; требуется ручная проверка",
    )


def sales_table_error_response(error):
    details = str(error)
    lowered = details.lower()
    missing_markers = (
        "trt_sales_periods",
        "trt_sales_monthly",
        "path does not exist",
        "scheme error",
        "table not found",
    )
    if any(marker in lowered for marker in missing_markers):
        return json_response(
            503,
            {
                "error": (
                    "Таблицы продаж в YDB ещё не созданы. "
                    "Выполните SQL-файл 01_create_sales_tables.sql."
                ),
                "details": details[:1000],
            },
        )
    return json_response(
        500,
        {
            "error": "Не удалось выполнить операцию с продажами.",
            "details": details[:1000],
        },
    )


def sales_period_exists(year, month):
    result_sets = execute_query(
        """
        DECLARE $year AS Uint32;
        DECLARE $month AS Uint32;

        SELECT active_import_id
        FROM trt_sales_periods
        WHERE year = $year AND month = $month
        LIMIT 1;
        """,
        {
            "$year": uint32(year),
            "$month": uint32(month),
        },
    )
    return bool(result_sets[0].rows)


def preview_sales_import(year, month, rows):
    point_index = build_sales_point_index(
        load_trt_payload().get("points", [])
    )
    result_rows = []
    totals_by_direction = {}
    counts = {
        "matched": 0,
        "unmatched": 0,
        "ambiguous": 0,
        "invalid": 0,
    }
    total_quantity = 0.0

    for index, source in enumerate(rows, start=2):
        if not isinstance(source, dict):
            source = {}
        status, point_id, message = match_sales_row(source, point_index)
        quantity = parse_sales_quantity(source.get("quantity"))
        row = {
            "rowNumber": source.get("rowNumber") or index,
            "direction": clean_text(source.get("direction"), 300),
            "manager": clean_text(source.get("manager"), 300),
            "client": clean_text(source.get("client"), 500),
            "location": clean_text(source.get("location"), 1000),
            "quantity": quantity,
            "status": status,
            "pointId": point_id,
            "message": message,
        }
        result_rows.append(row)
        counts[status] = counts.get(status, 0) + 1

        if status == "matched" and quantity is not None:
            direction_label = row["direction"] or "Без направления"
            totals_by_direction[direction_label] = (
                totals_by_direction.get(direction_label, 0.0)
                + quantity
            )
            total_quantity += quantity

    return {
        "periodExists": sales_period_exists(year, month),
        "periodLabel": sales_period_label(year, month),
        "summary": {
            "totalRows": len(result_rows),
            "matchedRows": counts.get("matched", 0),
            "unmatchedRows": (
                counts.get("unmatched", 0)
                + counts.get("ambiguous", 0)
            ),
            "invalidRows": counts.get("invalid", 0),
            "totalQuantity": total_quantity,
        },
        "totalsByDirection": [
            {"direction": key, "quantity": value}
            for key, value in sorted(totals_by_direction.items())
        ],
        "rows": result_rows,
    }


def upsert_sales_rows_batch(
    year,
    month,
    import_id,
    file_name,
    uploaded_by,
    uploaded_at,
    rows,
):
    declarations = [
        "DECLARE $year AS Uint32;",
        "DECLARE $month AS Uint32;",
        "DECLARE $import_id AS Utf8;",
        "DECLARE $file_name AS Utf8;",
        "DECLARE $uploaded_by AS Utf8;",
        "DECLARE $uploaded_at AS Timestamp;",
    ]
    parameters = {
        "$year": uint32(year),
        "$month": uint32(month),
        "$import_id": utf8(import_id),
        "$file_name": utf8(file_name),
        "$uploaded_by": utf8(uploaded_by),
        "$uploaded_at": timestamp(uploaded_at),
    }
    values = []

    for index, row in enumerate(rows):
        fields = {
            "point_id": utf8(row["pointId"]),
            "quantity": ydb.TypedValue(
                float(row["quantity"]),
                ydb.PrimitiveType.Double,
            ),
            "direction": utf8(row.get("direction") or ""),
            "manager": utf8(row.get("manager") or ""),
            "client": utf8(row.get("client") or ""),
            "location": utf8(row.get("location") or ""),
            "source_rows": utf8(
                ",".join(
                    str(item)
                    for item in row.get("sourceRows", [])
                )
            ),
        }
        type_by_name = {
            "point_id": "Utf8",
            "quantity": "Double",
            "direction": "Utf8",
            "manager": "Utf8",
            "client": "Utf8",
            "location": "Utf8",
            "source_rows": "Utf8",
        }
        placeholders = []
        for name, typed_value in fields.items():
            parameter_name = f"${name}_{index}"
            declarations.append(
                f"DECLARE {parameter_name} AS {type_by_name[name]};"
            )
            parameters[parameter_name] = typed_value
            placeholders.append(parameter_name)

        values.append(
            "(" + ", ".join(
                [
                    "$year",
                    "$month",
                    "$import_id",
                    placeholders[0],
                    placeholders[1],
                    placeholders[2],
                    placeholders[3],
                    placeholders[4],
                    placeholders[5],
                    placeholders[6],
                    "$file_name",
                    "$uploaded_by",
                    "$uploaded_at",
                ]
            ) + ")"
        )

    query = "\n".join(declarations) + """

        UPSERT INTO trt_sales_monthly (
            year,
            month,
            import_id,
            point_id,
            quantity,
            direction,
            manager,
            client,
            location,
            source_rows,
            file_name,
            uploaded_by,
            uploaded_at
        ) VALUES
    """ + ",\n".join(values) + ";"

    execute_query(query, parameters)


def activate_sales_period(
    year,
    month,
    import_id,
    file_name,
    uploaded_by,
    uploaded_at,
    row_count,
    total_quantity,
):
    execute_query(
        """
        DECLARE $year AS Uint32;
        DECLARE $month AS Uint32;
        DECLARE $active_import_id AS Utf8;
        DECLARE $file_name AS Utf8;
        DECLARE $uploaded_by AS Utf8;
        DECLARE $uploaded_at AS Timestamp;
        DECLARE $row_count AS Uint32;
        DECLARE $total_quantity AS Double;

        UPSERT INTO trt_sales_periods (
            year,
            month,
            active_import_id,
            file_name,
            uploaded_by,
            uploaded_at,
            row_count,
            total_quantity
        ) VALUES (
            $year,
            $month,
            $active_import_id,
            $file_name,
            $uploaded_by,
            $uploaded_at,
            $row_count,
            $total_quantity
        );
        """,
        {
            "$year": uint32(year),
            "$month": uint32(month),
            "$active_import_id": utf8(import_id),
            "$file_name": utf8(file_name),
            "$uploaded_by": utf8(uploaded_by),
            "$uploaded_at": timestamp(uploaded_at),
            "$row_count": uint32(row_count),
            "$total_quantity": ydb.TypedValue(
                float(total_quantity),
                ydb.PrimitiveType.Double,
            ),
        },
    )


def commit_sales_import(
    year,
    month,
    rows,
    file_name,
    replace,
    context,
):
    preview = preview_sales_import(year, month, rows)
    if preview["periodExists"] and not replace:
        return json_response(
            409,
            {
                "error": (
                    f"Продажи за {sales_period_label(year, month)} "
                    "уже загружены. Подтвердите замену данных."
                )
            },
        )

    matched = [
        row for row in preview["rows"]
        if row.get("status") == "matched"
    ]
    if not matched:
        return json_response(
            400,
            {
                "error": (
                    "Нет ни одной строки, которую можно безопасно загрузить."
                )
            },
        )

    aggregated = {}
    for row in matched:
        point_id = str(row["pointId"])
        if point_id not in aggregated:
            aggregated[point_id] = dict(row)
            aggregated[point_id]["sourceRows"] = [
                int(row.get("rowNumber") or 0)
            ]
        else:
            aggregated[point_id]["quantity"] = (
                float(aggregated[point_id]["quantity"])
                + float(row["quantity"])
            )
            aggregated[point_id]["sourceRows"].append(
                int(row.get("rowNumber") or 0)
            )

    stored_rows = list(aggregated.values())
    import_id = secrets.token_hex(16)
    file_name = clean_text(file_name or "sales.xlsx", 300)
    uploaded_by = str(context["employee"].employee_id)
    uploaded_at = parse_iso_timestamp(None)

    for start in range(0, len(stored_rows), SALES_BATCH_SIZE):
        upsert_sales_rows_batch(
            year,
            month,
            import_id,
            file_name,
            uploaded_by,
            uploaded_at,
            stored_rows[start:start + SALES_BATCH_SIZE],
        )

    activate_sales_period(
        year,
        month,
        import_id,
        file_name,
        uploaded_by,
        uploaded_at,
        len(stored_rows),
        sum(float(row["quantity"]) for row in stored_rows),
    )

    skipped = len(preview["rows"]) - len(matched)
    return json_response(
        200,
        {
            "ok": True,
            "importId": import_id,
            "periodLabel": sales_period_label(year, month),
            "importedRows": len(matched),
            "storedPoints": len(stored_rows),
            "skippedRows": skipped,
            "totalQuantity": preview["summary"]["totalQuantity"],
            "message": (
                f"Продажи за {sales_period_label(year, month)} загружены: "
                f"{len(matched)} строк. Пропущено: {skipped}."
            ),
        },
    )


def sales_import_request(data, request_event):
    context, error_response = read_authenticated_context(
        data,
        request_event,
    )
    if error_response is not None:
        return error_response

    if not is_system_admin(context):
        return json_response(
            403,
            {
                "error": (
                    "Загрузка продаж доступна только администратору системы."
                )
            },
        )

    try:
        year, month = validate_sales_period(
            data.get("year"),
            data.get("month"),
        )
    except ValueError as error:
        return json_response(400, {"error": str(error)})

    rows = data.get("rows")
    if not isinstance(rows, list):
        return json_response(
            400,
            {"error": "В запросе отсутствуют строки продаж."},
        )
    if len(rows) > MAX_SALES_IMPORT_ROWS:
        return json_response(
            400,
            {"error": "Файл содержит слишком много строк для одной загрузки."},
        )

    operation = clean_text(data.get("operation"), 30).lower()
    try:
        if operation == "preview":
            return json_response(
                200,
                preview_sales_import(year, month, rows),
            )
        if operation == "commit":
            return commit_sales_import(
                year,
                month,
                rows,
                data.get("fileName"),
                bool(data.get("replace")),
                context,
            )
        return json_response(
            400,
            {"error": "Неизвестная операция загрузки продаж."},
        )
    except Exception as error:
        print("Sales import error:", repr(error))
        return sales_table_error_response(error)


def list_active_monthly_sales():
    periods_sets = execute_query(
        """
        SELECT
            year,
            month,
            active_import_id
        FROM trt_sales_periods;
        """
    )

    result = []
    for period in periods_sets[0].rows:
        row_sets = execute_query(
            """
            DECLARE $year AS Uint32;
            DECLARE $month AS Uint32;
            DECLARE $import_id AS Utf8;

            SELECT
                point_id,
                quantity
            FROM trt_sales_monthly
            WHERE
                year = $year
                AND month = $month
                AND import_id = $import_id;
            """,
            {
                "$year": uint32(period.year),
                "$month": uint32(period.month),
                "$import_id": utf8(period.active_import_id),
            },
        )
        for row in row_sets[0].rows:
            result.append(
                {
                    "year": int(period.year),
                    "month": int(period.month),
                    "pointId": str(row.point_id),
                    "quantity": float(row.quantity or 0),
                }
            )
    return result


def merge_active_sales_into_points(points):
    result = [dict(point) for point in points]
    by_id = {
        sales_point_id(point): point
        for point in result
        if sales_point_id(point)
    }

    try:
        monthly_rows = list_active_monthly_sales()
    except Exception as error:
        # До выполнения SQL-миграции карта продолжает работать без новых продаж.
        print("Sales read warning:", repr(error))
        return result

    for row in monthly_rows:
        point = by_id.get(row["pointId"])
        if point is None:
            continue
        year = str(row["year"])
        month = int(row["month"])
        sales = dict(point.get("sales") or {})
        values = list(sales.get(year) or [])
        values.extend([None] * (12 - len(values)))
        values = values[:12]
        values[month - 1] = row["quantity"]
        sales[year] = values
        point["sales"] = sales

    return result

def list_trt_map_data(
    data,
    request_event,
):
    context, error_response = (
        read_authenticated_context(
            data,
            request_event,
        )
    )
    if error_response is not None:
        return error_response

    profile = access_profile_for_context(
        context
    )

    try:
        payload = filtered_trt_payload(
            profile
        )
        payload["points"] = merge_active_sales_into_points(
            payload.get("points", [])
        )
    except (OSError, ValueError) as error:
        return json_response(
            500,
            {
                "error": (
                    "Не удалось загрузить "
                    "защищённый справочник ТРТ."
                ),
                "details": str(error),
            },
        )

    return json_response(
        200,
        payload,
    )


def route_request(event):
    if (
        event.get("action")
        == "bootstrap_admin"
    ):
        return json_response(
            403,
            {
                "error": (
                    "Первичная регистрация "
                    "администратора отключена."
                )
            },
        )

    if event.get("action") == "login":
        return login_user(
            event,
            event,
        )

    if event.get("action") == "me":
        return current_user(
            event,
            event,
        )

    if event.get("action") == "logout":
        return logout_user(
            event,
            event,
        )

    if event.get("action") == "sync_visits":
        return sync_visits(
            event,
            event,
        )

    if event.get("action") == "list_visits":
        return list_visits(
            event,
            event,
        )

    if event.get("action") == "sync_tasks":
        return sync_tasks(
            event,
            event,
        )

    if event.get("action") == "list_tasks":
        return list_tasks(
            event,
            event,
        )

    if event.get("action") == "media_upload_url":
        return create_media_upload_url(
            event,
            event,
        )

    if event.get("action") == "media_complete":
        return complete_media_upload(
            event,
            event,
        )

    if event.get("action") == "list_media":
        return list_media(
            event,
            event,
        )

    if event.get("action") == "media_thumbnail_url":
        return create_media_thumbnail_url(
            event,
            event,
        )

    if event.get("action") == "list_trt_map_data":
        return list_trt_map_data(event, event)

    if event.get("action") == "list_employees":
        return list_employees(
            event,
            event,
        )

    if event.get("action") == "save_employee":
        return save_employee(
            event,
            event,
        )

    if event.get("action") == "invite_employee":
        return invite_employee(
            event,
            event,
        )

    if event.get("action") == "sales_import":
        return sales_import_request(
            event,
            event,
        )

    method = str(
        event.get("httpMethod") or ""
    ).upper()

    if not method:
        method = str(
            (
                event.get("requestContext")
                or {}
            )
            .get("http", {})
            .get("method")
            or ""
        ).upper()

    path = str(
        event.get("path")
        or event.get("rawPath")
        or ""
    )

    if path != "/":
        path = path.rstrip("/")

    if method == "OPTIONS":
        return json_response(
            204,
            {},
        )

    if (
        method == "GET"
        and path == "/health"
    ):
        return health()

    if (
        method == "POST"
        and path == "/auth/login"
    ):
        body = parse_body(event)

        if not body:
            return json_response(
                400,
                {
                    "error": (
                        "Тело запроса должно "
                        "быть JSON-объектом."
                    )
                },
            )

        return login_user(
            body,
            event,
        )

    if (
        method == "GET"
        and path == "/auth/me"
    ):
        return current_user(
            {},
            event,
        )

    if (
        method == "POST"
        and path == "/auth/logout"
    ):
        return logout_user(
            parse_body(event),
            event,
        )

    if (
        method == "POST"
        and path == "/visits/sync"
    ):
        return sync_visits(
            parse_body(event),
            event,
        )

    if (
        method == "GET"
        and path == "/visits"
    ):
        return list_visits(
            {},
            event,
        )

    if (
        method == "POST"
        and path == "/tasks/sync"
    ):
        return sync_tasks(
            parse_body(event),
            event,
        )

    if (
        method == "GET"
        and path == "/tasks"
    ):
        return list_tasks(
            {},
            event,
        )

    if (
        method == "GET"
        and path == "/trt-map-data"
    ):
        return list_trt_map_data({}, event)

    if (
        method == "GET"
        and path == "/employees"
    ):
        return list_employees(
            {},
            event,
        )

    if (
        method == "POST"
        and path == "/employees"
    ):
        body = parse_body(event)
        if str(
            body.get("operation") or ""
        ).lower() == "invite":
            return invite_employee(
                body,
                event,
            )
        return save_employee(
            body,
            event,
        )

    if (
        method == "POST"
        and path == "/admin/sales-import"
    ):
        return sales_import_request(
            parse_body(event),
            event,
        )

    if (
        method == "POST"
        and path == "/media/upload-url"
    ):
        return create_media_upload_url(
            parse_body(event),
            event,
        )

    if (
        method == "POST"
        and path == "/media/complete"
    ):
        return complete_media_upload(
            parse_body(event),
            event,
        )

    if (
        method == "GET"
        and path == "/media"
    ):
        return list_media(
            {},
            event,
        )

    if (
        method == "POST"
        and path == "/media/thumbnail-url"
    ):
        return create_media_thumbnail_url(
            parse_body(event),
            event,
        )

    if not event:
        return health()

    return json_response(
        404,
        {
            "error": "Маршрут не найден."
        },
    )


def handler(event, context):
    event = normalize_event(event)

    try:
        return route_request(event)
    except Exception as error:
        print(
            "Unhandled API error:",
            repr(error),
        )

        return json_response(
            500,
            {
                "error": (
                    "Внутренняя ошибка "
                    "сервера."
                ),
                "api_version": API_VERSION,
            },
        )
