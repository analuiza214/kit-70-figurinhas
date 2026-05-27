const https = require("https");

function httpsPost(url, data, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const body = JSON.stringify(data);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        ...headers,
      },
    };
    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, body: raw });
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const publicKey = process.env.SIGILOPAY_PUBLIC_KEY;
  const secretKey = process.env.SIGILOPAY_SECRET_KEY;

  if (!publicKey || !secretKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Gateway de pagamento não configurado." }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "JSON inválido." }) };
  }

  const { amount, name, email, phone, document, address, productName } = body;

  if (!amount || !name || !email || !address) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Campos obrigatórios não informados." }),
    };
  }

  const identifier = `order-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const clientIp =
    event.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "0.0.0.0";

  const rawZip = (address.zipCode || address.cep || "").replace(/\D/g, "");
  const formattedZip =
    rawZip.length === 8
      ? `${rawZip.slice(0, 5)}-${rawZip.slice(5)}`
      : rawZip || "00000-000";

  const payload = {
    amount: Number(amount),
    identifier,
    client: {
      name,
      email,
      ...(phone ? { phone: String(phone).replace(/\D/g, "") } : {}),
      ...(document ? { document: String(document).replace(/\D/g, "") } : {}),
      address: {
        country: "BR",
        zipCode: formattedZip,
        state: address.state || address.uf || "SP",
        city: address.city || "Não informado",
        street: address.street || "Não informado",
        neighborhood: address.neighborhood || "Não informado",
        number: address.number || "S/N",
        ...(address.complement ? { complement: address.complement } : {}),
      },
    },
    products: [
      {
        id: "prod-001",
        name: productName || "Kit 70 Figurinhas Copa 2026",
        quantity: 1,
        price: Number(amount),
      },
    ],
    clientIp,
  };

  try {
    const result = await httpsPost(
      "https://app.sigilopay.com.br/api/v1/gateway/pix/receive",
      payload,
      {
        "x-public-key": publicKey,
        "x-secret-key": secretKey,
      }
    );

    if (result.status < 200 || result.status >= 300) {
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Erro ao gerar PIX. Tente novamente.",
          details: result.body,
        }),
      };
    }

    const data = result.body;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transactionId: data.transactionId,
        status: data.status,
        pixCode: data.pix?.code,
        qrCodeBase64: data.pix?.base64,
        qrCodeImage: data.pix?.image,
      }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Erro de comunicação com o gateway de pagamento.",
      }),
    };
  }
};
