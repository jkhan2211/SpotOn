import os
import logging
import boto3
from pathlib import Path
from dotenv import load_dotenv
from botocore.exceptions import BotoCoreError, ClientError

load_dotenv(Path(__file__).parent.parent / ".env")

logger = logging.getLogger(__name__)

ses_client = boto3.client("ses", region_name=os.environ.get("AWS_REGION", "us-east-1"))

FROM_EMAIL = os.environ.get("SPOTON_SES_FROM_EMAIL", "")


def send_permit_confirmation_email(
    recipient_email: str,
    permit_id: str,
    visitor_name: str,
    visitor_plate: str,
    space_id: str,
    start_time: str,
    end_time: str,
    available_spaces: int | None = None,
    total_spaces: int | None = None,
) -> dict:
    availability_line_text = (
        f"\nAvailable Spaces: {available_spaces} of {total_spaces}\n"
        if available_spaces is not None and total_spaces is not None else ""
    )
    availability_line_html = (
        f"<p>🅿️ <strong>Parking Availability:</strong> {available_spaces} of {total_spaces} spaces remaining</p>"
        if available_spaces is not None and total_spaces is not None else ""
    )

    plain = f"""SpotOn Agent — Visitor Parking Booking Confirmation

Hello,

Your SpotOn Agent is reaching out to confirm that a visitor parking booking has been successfully created.

Permit ID:      {permit_id}
Visitor:        {visitor_name}
Licence Plate:  {visitor_plate}
Assigned Space: {space_id}
Time:           {start_time} - {end_time}
{availability_line_text}
SpotOn has verified parking availability and reserved the assigned space for this visit.

Need to cancel or leaving early? Log in to the SpotOn app and update your booking.
Releasing the space early helps SpotOn make it available to other residents.

Best,
SpotOn Agent
Park with ease, live in peace."""

    html = f"""
    <html>
    <body style="font-family: Arial, sans-serif; background: #f8f9fb; padding: 32px;">
      <div style="max-width: 520px; margin: auto; background: white; border-radius: 12px;
                  box-shadow: 0 2px 12px rgba(0,0,0,0.08); overflow: hidden;">

        <!-- Header -->
        <div style="background: #0f1f3d; padding: 24px 32px;">
          <h1 style="color: white; margin: 0; font-size: 20px;">🅿️ SpotOn Agent</h1>
          <p style="color: #0e9aad; margin: 4px 0 0; font-size: 13px;">Visitor Parking Booking Confirmation</p>
        </div>

        <!-- Body -->
        <div style="padding: 28px 32px;">
          <p style="color: #333;">Hello,</p>
          <p style="color: #333;">Your <strong>SpotOn Agent</strong> is reaching out to confirm that a visitor parking booking has been successfully created. ✅</p>

          <!-- Permit card -->
          <div style="background: #f0f9fb; border-left: 4px solid #0e9aad; border-radius: 8px;
                      padding: 16px 20px; margin: 20px 0;">
            <p style="margin: 8px 0;">🎫 <strong>Permit ID:</strong> {permit_id}</p>
            <p style="margin: 8px 0;">👤 <strong>Visitor:</strong> {visitor_name}</p>
            <p style="margin: 8px 0;">🚗 <strong>Licence Plate:</strong> {visitor_plate}</p>
            <p style="margin: 8px 0;">🅿️ <strong>Assigned Space:</strong> {space_id}</p>
            <p style="margin: 8px 0;">⏰ <strong>Booking Time:</strong> {start_time} – {end_time}</p>
            {availability_line_html}
          </div>

          <p style="color: #333;">SpotOn has verified parking availability and reserved the assigned space for this visit.</p>

          <div style="background: #fff8e1; border-radius: 8px; padding: 14px 18px; margin: 20px 0;
                      border-left: 4px solid #f5a623;">
            <p style="margin: 0; color: #555; font-size: 13px;">
              💡 <em>Need to cancel or leaving earlier than expected? Log in to the SpotOn app and update your booking.
              Releasing the space early helps SpotOn make it available to other residents who may be waiting.</em>
            </p>
          </div>
        </div>

        <!-- Footer -->
        <div style="background: #f0f0f0; padding: 16px 32px; text-align: center;">
          <p style="margin: 0; font-size: 13px; color: #888;">🤖 <strong>SpotOn Agent</strong></p>
          <p style="margin: 4px 0 0; font-size: 12px; color: #aaa;"><em>Park with ease, live in peace.</em></p>
        </div>

      </div>
    </body>
    </html>
    """

    try:
        response = ses_client.send_email(
            Source=FROM_EMAIL,
            Destination={"ToAddresses": [recipient_email]},
            Message={
                "Subject": {"Data": "SpotOn Agent — Visitor Parking Booking Confirmation 🅿️"},
                "Body": {
                    "Text": {"Data": plain},
                    "Html": {"Data": html},
                },
            },
        )
        logger.info("SES email sent: %s", response["MessageId"])
        return {"success": True, "message_id": response["MessageId"]}
    except (BotoCoreError, ClientError) as e:
        logger.error("SES email failed: %s", e)
        return {"success": False, "error": str(e)}
