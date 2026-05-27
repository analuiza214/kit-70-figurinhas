import { Router } from "express";

const router = Router();

router.post("/pix/create", async (req, res) => {
  const publicKey = process.env.SIGILOPAY_PUBLIC_KEY;
  const secretKey = process.env.SIGILOPAY_SECRET_KEY;
  if (!publicKey || !secretKey) {
    req.log.error("SIGILOPAY_PUBLIC_KEY or SIGILOPAY_SECRET_KEY not configured");
    res.status(500).json({ error: "Gateway de pagamento não configurado." });
    return;
  }

  const { amount, name, email, phone, document, address, productName } = req.body;

  if (!amount || !name || !email || !address) {
    res.status(400).json({ error: "Campos obrigatórios não informados." });
    return;
  }

  const identifier = `order-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const clientIp =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "0.0.0.0";

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
        zipCode: (() => {
          const raw = (address.zipCode || address.cep || "").replace(/\D/g, "");
          return raw.length === 8 ? `${raw.slice(0, 5)}-${raw.slice(5)}` : raw || "00000-000";
        })(),
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
    const response = await fetch(
      "https://app.sigilopay.com.br/api/v1/gateway/pix/receive",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-public-key": publicKey,
          "x-secret-key": secretKey,
        },
        body: JSON.stringify(payload),
      }
    );

    const data = (await response.json()) as {
      transactionId?: string;
      status?: string;
      pix?: { code?: string; base64?: string; image?: string };
      message?: string;
      details?: unknown;
    };

    if (!response.ok) {
      req.log.error({ status: response.status, data }, "Sigilo Pay error");
      res.status(502).json({
        error: "Erro ao gerar PIX. Tente novamente.",
        details: data,
      });
      return;
    }

    res.json({
      transactionId: data.transactionId,
      status: data.status,
      pixCode: data.pix?.code,
      qrCodeBase64: data.pix?.base64,
      qrCodeImage: data.pix?.image,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to call Sigilo Pay");
    res.status(502).json({ error: "Erro de comunicação com o gateway de pagamento." });
  }
});

export default router;
