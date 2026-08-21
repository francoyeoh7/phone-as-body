#!/usr/bin/env node
// 阿里云 DNS 操作小工具（仅本地部署用，勿提交）
// 用法:
//   node scripts/dns-tool.mjs list
//   node scripts/dns-tool.mjs add-a <主机记录> <IP>
//   node scripts/dns-tool.mjs txt-add <主机记录> <值>
//   node scripts/dns-tool.mjs delete <RecordId>
import { createHmac, randomUUID } from "node:crypto";

const ACCESS_KEY_ID = process.env.ALI_KEY;
const ACCESS_KEY_SECRET = process.env.ALI_SECRET;
const DOMAIN = process.env.ALI_DOMAIN || "tokenxapp.com";

if (!ACCESS_KEY_ID || !ACCESS_KEY_SECRET) {
  console.error("missing ALI_KEY / ALI_SECRET env");
  process.exit(1);
}

function percentEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/\+/g, "%20")
    .replace(/\*/g, "%2A")
    .replace(/%7E/g, "~");
}

function signedParams(action, extra = {}) {
  const params = {
    Action: action,
    Format: "JSON",
    Version: "2015-01-09",
    AccessKeyId: ACCESS_KEY_ID,
    SignatureMethod: "HMAC-SHA1",
    SignatureVersion: "1.0",
    SignatureNonce: randomUUID(),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    ...extra,
  };
  const sorted = Object.keys(params).sort();
  const canonical = sorted.map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`).join("&");
  const stringToSign = `GET&%2F&${percentEncode(canonical)}`;
  const signature = createHmac("sha1", `${ACCESS_KEY_SECRET}&`).update(stringToSign).digest("base64");
  return { ...params, Signature: signature };
}

async function call(action, extra) {
  const params = signedParams(action, extra);
  const query = Object.keys(params)
    .map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join("&");
  const response = await fetch(`https://alidns.aliyuncs.com/?${query}`);
  const body = await response.json();
  if (body.Code) throw new Error(`${body.Code}: ${body.Message}`);
  return body;
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "list") {
    const body = await call("DescribeDomainRecords", { DomainName: DOMAIN, PageSize: "100" });
    for (const record of body.DomainRecords?.Record ?? []) {
      console.log(`${record.RecordId}  ${record.Type.padEnd(6)} ${String(record.RR).padEnd(20)} -> ${record.Value}`);
    }
    console.log(`total: ${body.TotalCount}`);
  } else if (command === "add-a") {
    const body = await call("AddDomainRecord", {
      DomainName: DOMAIN,
      RR: args[0],
      Type: "A",
      Value: args[1],
    });
    console.log("added:", body.RecordId);
  } else if (command === "txt-add") {
    const body = await call("AddDomainRecord", {
      DomainName: DOMAIN,
      RR: args[0],
      Type: "TXT",
      Value: args[1],
    });
    console.log("added:", body.RecordId);
  } else if (command === "delete") {
    const body = await call("DeleteDomainRecord", { RecordId: args[0] });
    console.log("deleted:", body.RecordId);
  } else {
    console.error("commands: list | add-a <rr> <ip> | txt-add <rr> <value> | delete <recordId>");
    process.exit(1);
  }
} catch (error) {
  console.error("ERROR:", error.message);
  process.exit(1);
}
