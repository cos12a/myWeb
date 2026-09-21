import { describe, expect, test } from "bun:test";
import {
  classifyField,
  classifyPayload,
  tryParseNumericString,
  TAG_FIELDS,
  NUMERIC_FIELD_HINTS,
} from "../src/services/fieldClassifier";

describe("tryParseNumericString", () => {
  test("解析正常数字字符串", () => {
    expect(tryParseNumericString("25.6")).toBe(25.6);
    expect(tryParseNumericString("-10")).toBe(-10);
    expect(tryParseNumericString("0")).toBe(0);
    expect(tryParseNumericString("1e3")).toBe(1000);
  });

  test("自动 trim 空白", () => {
    expect(tryParseNumericString("  25.6  ")).toBe(25.6);
    expect(tryParseNumericString("\t42\n")).toBe(42);
  });

  test("空字符串返回 null", () => {
    expect(tryParseNumericString("")).toBeNull();
    expect(tryParseNumericString("   ")).toBeNull();
  });

  test("非数字字符串返回 null", () => {
    expect(tryParseNumericString("ok")).toBeNull();
    expect(tryParseNumericString("1.2.3")).toBeNull();
    expect(tryParseNumericString("25.6abc")).toBeNull();
  });

  test("NaN / Infinity 字面量返回 null（Number.isFinite 拦截）", () => {
    expect(tryParseNumericString("NaN")).toBeNull();
    expect(tryParseNumericString("Infinity")).toBeNull();
    expect(tryParseNumericString("-Infinity")).toBeNull();
  });
});

describe("classifyField - null/undefined", () => {
  test("null → skip", () => {
    const r = classifyField("temperature", null);
    expect(r.kind).toBe("skip");
    expect(r.reason).toBe("null/undefined");
  });

  test("undefined → skip", () => {
    const r = classifyField("temperature", undefined);
    expect(r.kind).toBe("skip");
    expect(r.reason).toBe("null/undefined");
  });
});

describe("classifyField - Tag 字段", () => {
  test("location 字符串 → tag", () => {
    const r = classifyField("location", "living-room");
    expect(r.kind).toBe("tag");
    expect(r.value).toBe("living-room");
  });

  test("type 字符串 → tag", () => {
    const r = classifyField("type", "dht22");
    expect(r.kind).toBe("tag");
    expect(r.value).toBe("dht22");
  });

  test("location 是数字 → 不当 tag，走 float 分支", () => {
    const r = classifyField("location", 42);
    expect(r.kind).toBe("float");
  });

  test("TAG_FIELDS 集合内容正确", () => {
    expect(TAG_FIELDS.has("location")).toBe(true);
    expect(TAG_FIELDS.has("type")).toBe(true);
    expect(TAG_FIELDS.has("status")).toBe(false);
  });
});

describe("classifyField - 数值", () => {
  test("普通数字 → float", () => {
    const r = classifyField("temperature", 25.6);
    expect(r.kind).toBe("float");
    expect(r.value).toBe(25.6);
    expect(r.coerced).toBeUndefined();
  });

  test("整数 → float", () => {
    const r = classifyField("count", 42);
    expect(r.kind).toBe("float");
    expect(r.value).toBe(42);
  });

  test("负数 → float", () => {
    const r = classifyField("temperature", -5.5);
    expect(r.kind).toBe("float");
    expect(r.value).toBe(-5.5);
  });

  test("0 → float", () => {
    const r = classifyField("temperature", 0);
    expect(r.kind).toBe("float");
    expect(r.value).toBe(0);
  });

  test("NaN → skip（non-finite）", () => {
    const r = classifyField("temperature", Number.NaN);
    expect(r.kind).toBe("skip");
    expect(r.reason).toBe("non-finite number");
  });

  test("Infinity → skip（non-finite）", () => {
    const r = classifyField("temperature", Number.POSITIVE_INFINITY);
    expect(r.kind).toBe("skip");
  });
});

describe("classifyField - 布尔", () => {
  test("true → boolean", () => {
    const r = classifyField("online", true);
    expect(r.kind).toBe("boolean");
    expect(r.value).toBe(true);
  });

  test("false → boolean", () => {
    const r = classifyField("online", false);
    expect(r.kind).toBe("boolean");
    expect(r.value).toBe(false);
  });
});

describe("classifyField - 字符串（非白名单）", () => {
  test("status='ok' → string", () => {
    const r = classifyField("status", "ok");
    expect(r.kind).toBe("string");
    expect(r.value).toBe("ok");
    expect(r.coerced).toBeUndefined();
  });

  test("firmware='1.2.3' → string（即使看起来像数字也不是白名单字段）", () => {
    const r = classifyField("firmware", "1.2.3");
    expect(r.kind).toBe("string");
    expect(r.value).toBe("1.2.3");
  });

  test("未知字段='25.6' → string（不在白名单，不强转）", () => {
    const r = classifyField("someRandomField", "25.6");
    expect(r.kind).toBe("string");
    expect(r.value).toBe("25.6");
  });
});

describe("classifyField - 字符串（白名单自动强转）", () => {
  test("temperature='25.6' → float（coerced）", () => {
    const r = classifyField("temperature", "25.6");
    expect(r.kind).toBe("float");
    expect(r.value).toBe(25.6);
    expect(r.coerced).toBe(true);
    expect(r.raw).toBe("25.6");
  });

  test("humidity=' 60.2 ' → float（含空白也能强转）", () => {
    const r = classifyField("humidity", " 60.2 ");
    expect(r.kind).toBe("float");
    expect(r.value).toBe(60.2);
    expect(r.coerced).toBe(true);
  });

  test("battery='3.7' → float", () => {
    const r = classifyField("battery", "3.7");
    expect(r.kind).toBe("float");
    expect(r.value).toBe(3.7);
    expect(r.coerced).toBe(true);
  });

  test("rssi='-65' → float（负数）", () => {
    const r = classifyField("rssi", "-65");
    expect(r.kind).toBe("float");
    expect(r.value).toBe(-65);
  });

  test("pm25='35' → float（整数字符串）", () => {
    const r = classifyField("pm25", "35");
    expect(r.kind).toBe("float");
    expect(r.value).toBe(35);
  });

  test("temperature='error' → string（白名单但不可解析）", () => {
    const r = classifyField("temperature", "error");
    expect(r.kind).toBe("string");
    expect(r.value).toBe("error");
    expect(r.reason).toBe("numeric-hint but not parseable");
  });

  test("temperature='' → string（空字符串）", () => {
    const r = classifyField("temperature", "");
    expect(r.kind).toBe("string");
    expect(r.reason).toBe("numeric-hint but not parseable");
  });

  test("NUMERIC_FIELD_HINTS 至少覆盖常见字段", () => {
    for (const f of ["temperature", "humidity", "pressure", "battery", "rssi", "co2", "pm25"]) {
      expect(NUMERIC_FIELD_HINTS.has(f)).toBe(true);
    }
    // status/firmware/name 这类不应该是数值白名单
    for (const f of ["status", "firmware", "name", "messageId"]) {
      expect(NUMERIC_FIELD_HINTS.has(f)).toBe(false);
    }
  });
});

describe("classifyField - 复杂类型", () => {
  test("object → skip", () => {
    const r = classifyField("meta", { a: 1 });
    expect(r.kind).toBe("skip");
    expect(r.reason).toContain("unsupported type");
  });

  test("array → skip", () => {
    const r = classifyField("list", [1, 2, 3]);
    expect(r.kind).toBe("skip");
  });

  test("function → skip", () => {
    const r = classifyField("fn", () => {});
    expect(r.kind).toBe("skip");
  });

  test("bigint → skip", () => {
    const r = classifyField("big", BigInt(42));
    expect(r.kind).toBe("skip");
  });
});

describe("classifyPayload", () => {
  test("完整 payload 分类正确", () => {
    const payload = {
      temperature: 25.6,
      humidity: "60.2",          // 字符串数字，白名单强转
      online: true,
      status: "ok",               // 普通字符串
      location: "living-room",    // tag
      type: "dht22",              // tag
      meta: { nested: true },     // 跳过
      timestamp: 1758470400000,   // float（虽然实际用作时间戳，但分类器不管语义）
    };
    const results = classifyPayload(payload);
    const byKey = Object.fromEntries(results.map((r) => [r.key, r]));

    expect(byKey.temperature!.kind).toBe("float");
    expect(byKey.temperature!.coerced).toBeUndefined();

    expect(byKey.humidity!.kind).toBe("float");
    expect(byKey.humidity!.coerced).toBe(true);
    expect(byKey.humidity!.value).toBe(60.2);

    expect(byKey.online!.kind).toBe("boolean");
    expect(byKey.status!.kind).toBe("string");
    expect(byKey.location!.kind).toBe("tag");
    expect(byKey.type!.kind).toBe("tag");
    expect(byKey.meta!.kind).toBe("skip");
    expect(byKey.timestamp!.kind).toBe("float");
  });

  test("空 payload 返回空数组", () => {
    expect(classifyPayload({})).toEqual([]);
  });

  test("结果顺序与 Object.entries 一致", () => {
    const results = classifyPayload({ a: 1, b: 2, c: 3 });
    expect(results.map((r) => r.key)).toEqual(["a", "b", "c"]);
  });
});
