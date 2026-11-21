import json
from pathlib import Path
from urllib import response

import pymupdf as fitz
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()


def extract_invoice(file_path: str) -> dict:
    """Extract structured invoice information from a PDF using AI."""

    # Step 1: Read the PDF
    with fitz.open(file_path) as document:
        invoice_text = "\n".join(page.get_text() for page in document)

    if not invoice_text.strip():
        raise ValueError("No readable text found in the PDF.")

    # Step 2: Ask AI to understand the invoice
    client = OpenAI()

    response = client.responses.create(
        model="gpt-4.1-mini",
        input=[
            {
                "role": "system",
                "content": (
                    "You extract accounts payable invoice information. "
                    "Return only valid JSON. Never invent missing values. "
                    "Use null for missing fields. "
                    "Dates must use YYYY-MM-DD. "
                    "Amounts must be strings, not numbers. "
                    "Support English and French invoices."
                ),
            },
            {
                "role": "user",
                "content": (
                    "Extract the following fields from this invoice:\n"
                    "vendor_name, invoice_number, invoice_date, due_date, "
                    "currency, subtotal, gst_hst, pst_qst, total, "
                    "line_items.\n\n"
                    "Each line item should include description, quantity, "
                    "unit_price, and amount.\n\n"
                    f"Invoice text:\n{invoice_text}"
                ),
            },
        ],
    )

    # Step 3: Convert the AI's JSON into a Python dictionary
    text = response.output_text.strip()

    if text.startswith("```"):

        text = text.split("\n", 1)[1]

        text = text.rsplit("```", 1)[0].strip()

    return json.loads(text)