import os
import uuid
import logging
import boto3
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
from dotenv import load_dotenv
from botocore.exceptions import BotoCoreError, ClientError

load_dotenv(Path(__file__).parent.parent / ".env")

logger = logging.getLogger(__name__)

ses_client = boto3.client("ses", region_name=os.environ.get("AWS_REGION", "us-east-1"))

FROM_EMAIL = os.environ.get("SPOTON_SES_FROM_EMAIL", "")

# SPOTON_EMAIL_MODE=mock skips real SES sends (logs what would've been sent instead) —
# useful for end-to-end testing without burning SES free-tier send quota. Any other
# value (or unset) sends for real. Read once at import; restart the backend to change it.
EMAIL_MODE = os.environ.get("SPOTON_EMAIL_MODE", "live").strip().lower()


def _to_local(dt: datetime, tz_name: str | None) -> datetime:
    """Converts a UTC-aware datetime to tz_name (the resident's browser-reported
    IANA zone) when given and valid. Falls back to UTC — same as when no
    timezone is known at all — rather than failing the email over a display
    detail, e.g. an unrecognized zone name."""
    if not tz_name:
        return dt
    try:
        return dt.astimezone(ZoneInfo(tz_name))
    except Exception:
        return dt


def _format_date(iso_time: str, tz_name: str | None = None) -> str:
    """'2026-09-03T18:00:00Z' -> 'September 3, 2026' (in tz_name if given, else UTC).
    Falls back to the raw value if it doesn't parse, so a display glitch never
    blocks the email from sending."""
    try:
        dt = _to_local(datetime.fromisoformat(iso_time.replace("Z", "+00:00")), tz_name)
        return dt.strftime("%B %-d, %Y")
    except (ValueError, AttributeError):
        return iso_time


def _format_time(iso_time: str, tz_name: str | None = None) -> str:
    """'2026-09-03T18:00:00Z' -> '6:00 PM' (in tz_name if given, else UTC)."""
    try:
        dt = _to_local(datetime.fromisoformat(iso_time.replace("Z", "+00:00")), tz_name)
        return dt.strftime("%-I:%M %p")
    except (ValueError, AttributeError):
        return iso_time


def _send_email(recipient_email: str, subject: str, plain: str, html: str) -> dict:
    if EMAIL_MODE == "mock":
        logger.info("[MOCK EMAIL] to=%s subject=%r (SES call skipped)", recipient_email, subject)
        return {"success": True, "message_id": f"mock-{uuid.uuid4().hex[:12]}", "mock": True}

    try:
        response = ses_client.send_email(
            Source=FROM_EMAIL,
            Destination={"ToAddresses": [recipient_email]},
            Message={
                "Subject": {"Data": subject},
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
    tz_name: str | None = None,
) -> dict:
    date_str = _format_date(start_time, tz_name)
    time_str = f"{_format_time(start_time, tz_name)} – {_format_time(end_time, tz_name)}"

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
Date:           {date_str}
Time:           {time_str}
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
            <p style="margin: 8px 0;">📅 <strong>Date:</strong> {date_str}</p>
            <p style="margin: 8px 0;">⏰ <strong>Booking Time:</strong> {time_str}</p>
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

    return _send_email(recipient_email, "SpotOn Agent — Visitor Parking Booking Confirmation 🅿️", plain, html)


def send_temp_resident_confirmation_email(
    recipient_email: str,
    permit_id: str,
    vehicle_plate: str,
    space_id: str,
    start_time: str,
    end_time: str,
    reason: str,
    tz_name: str | None = None,
) -> dict:
    date_str = _format_date(start_time, tz_name)
    time_str = f"{_format_time(start_time, tz_name)} – {_format_time(end_time, tz_name)}"

    plain = f"""SpotOn Agent — Temporary Resident Parking Confirmation

Hello,

Your SpotOn Agent is reaching out to confirm that your temporary resident parking request has been approved.

Permit ID:      {permit_id}
Vehicle:        {vehicle_plate}
Assigned Space: {space_id}
Date:           {date_str}
Time:           {time_str}
Reason:         {reason}

SpotOn has verified parking availability and reserved the assigned space for your temporary use.

This message was automatically generated by the SpotOn Agent as part of the community parking workflow.

Need to cancel the booking or finish earlier than expected? Please log in to SpotOn and release your parking space.
Releasing the space early helps SpotOn make it available to other residents who may need it.

Best,
SpotOn Agent
Park with ease, live in peace."""

    html = f"""
    <html>
    <body style="font-family: Arial, sans-serif; background: #f8f9fb; padding: 32px;">
      <div style="max-width: 520px; margin: auto; background: white; border-radius: 12px;
                  box-shadow: 0 2px 12px rgba(0,0,0,0.08); overflow: hidden;">

        <div style="background: #0f1f3d; padding: 24px 32px;">
          <h1 style="color: white; margin: 0; font-size: 20px;">🅿️ SpotOn Agent</h1>
          <p style="color: #0e9aad; margin: 4px 0 0; font-size: 13px;">Temporary Resident Parking Confirmation</p>
        </div>

        <div style="padding: 28px 32px;">
          <p style="color: #333;">Hello,</p>
          <p style="color: #333;">Your <strong>SpotOn Agent</strong> is reaching out to confirm that your temporary resident parking request has been approved. ✅</p>

          <div style="background: #f0f9fb; border-left: 4px solid #0e9aad; border-radius: 8px;
                      padding: 16px 20px; margin: 20px 0;">
            <p style="margin: 8px 0;">🎫 <strong>Permit ID:</strong> {permit_id}</p>
            <p style="margin: 8px 0;">🚗 <strong>Vehicle:</strong> {vehicle_plate}</p>
            <p style="margin: 8px 0;">🅿️ <strong>Assigned Space:</strong> {space_id}</p>
            <p style="margin: 8px 0;">📅 <strong>Date:</strong> {date_str}</p>
            <p style="margin: 8px 0;">⏰ <strong>Parking Time:</strong> {time_str}</p>
            <p style="margin: 8px 0;">🛠️ <strong>Reason:</strong> {reason}</p>
          </div>

          <p style="color: #333;">SpotOn has verified parking availability and reserved the assigned space for your temporary use.</p>

          <div style="background: #fff8e1; border-radius: 8px; padding: 14px 18px; margin: 20px 0;
                      border-left: 4px solid #f5a623;">
            <p style="margin: 0; color: #555; font-size: 13px;">
              💡 <em>Need to cancel the booking or finish earlier than expected? Log in to SpotOn and release your
              parking space. Releasing the space early helps SpotOn make it available to other residents who may need it.</em>
            </p>
          </div>
        </div>

        <div style="background: #f0f0f0; padding: 16px 32px; text-align: center;">
          <p style="margin: 0; font-size: 13px; color: #888;">🤖 <strong>SpotOn Agent</strong></p>
          <p style="margin: 4px 0 0; font-size: 12px; color: #aaa;"><em>Park with ease, live in peace.</em></p>
        </div>

      </div>
    </body>
    </html>
    """

    return _send_email(recipient_email, "SpotOn Agent — Temporary Resident Parking Confirmation 🅿️", plain, html)


def send_temp_resident_admin_notification(
    recipient_email: str,
    permit_id: str,
    resident_unit: str,
    vehicle_plate: str,
    space_id: str,
    start_time: str,
    end_time: str,
    reason: str,
    tz_name: str | None = None,
) -> dict:
    date_str = _format_date(start_time, tz_name)
    time_str = f"{_format_time(start_time, tz_name)} – {_format_time(end_time, tz_name)}"

    plain = f"""SpotOn Agent — Temporary Resident Parking Notification

Hello,

The SpotOn Agent has created a temporary resident parking permit.

Permit details:

Permit ID:      {permit_id}
Resident Unit:  {resident_unit}
Vehicle:        {vehicle_plate}
Assigned Space: {space_id}
Date:           {date_str}
Time:           {time_str}
Reason:         {reason}

This permit was created automatically by SpotOn after validating the resident request and current parking availability.

No action is required unless manual review is needed.

Best,
SpotOn Agent"""

    html = f"""
    <html>
    <body style="font-family: Arial, sans-serif; background: #f8f9fb; padding: 32px;">
      <div style="max-width: 520px; margin: auto; background: white; border-radius: 12px;
                  box-shadow: 0 2px 12px rgba(0,0,0,0.08); overflow: hidden;">

        <div style="background: #0f1f3d; padding: 24px 32px;">
          <h1 style="color: white; margin: 0; font-size: 20px;">🅿️ SpotOn Agent</h1>
          <p style="color: #0e9aad; margin: 4px 0 0; font-size: 13px;">Temporary Resident Parking Notification</p>
        </div>

        <div style="padding: 28px 32px;">
          <p style="color: #333;">Hello,</p>
          <p style="color: #333;">The <strong>SpotOn Agent</strong> has created a temporary resident parking permit.</p>

          <div style="background: #f0f9fb; border-left: 4px solid #0e9aad; border-radius: 8px;
                      padding: 16px 20px; margin: 20px 0;">
            <p style="margin: 8px 0;">🎫 <strong>Permit ID:</strong> {permit_id}</p>
            <p style="margin: 8px 0;">🏠 <strong>Resident Unit:</strong> {resident_unit}</p>
            <p style="margin: 8px 0;">🚗 <strong>Vehicle:</strong> {vehicle_plate}</p>
            <p style="margin: 8px 0;">🅿️ <strong>Assigned Space:</strong> {space_id}</p>
            <p style="margin: 8px 0;">📅 <strong>Date:</strong> {date_str}</p>
            <p style="margin: 8px 0;">⏰ <strong>Time:</strong> {time_str}</p>
            <p style="margin: 8px 0;">🛠️ <strong>Reason:</strong> {reason}</p>
          </div>

          <p style="color: #555; font-size: 13px;">This permit was created automatically by SpotOn after validating the resident request and current parking availability. No action is required unless manual review is needed.</p>
        </div>

        <div style="background: #f0f0f0; padding: 16px 32px; text-align: center;">
          <p style="margin: 0; font-size: 13px; color: #888;">🤖 <strong>SpotOn Agent</strong></p>
        </div>

      </div>
    </body>
    </html>
    """

    return _send_email(recipient_email, "SpotOn Agent — Temporary Resident Parking Notification", plain, html)


def send_visitor_admin_notification(
    recipient_email: str,
    permit_id: str,
    resident_unit: str,
    visitor_name: str,
    visitor_plate: str,
    space_id: str,
    start_time: str,
    end_time: str,
    tz_name: str | None = None,
) -> dict:
    date_str = _format_date(start_time, tz_name)
    time_str = f"{_format_time(start_time, tz_name)} – {_format_time(end_time, tz_name)}"

    plain = f"""SpotOn Agent — Visitor Parking Notification

Hello,

The SpotOn Agent has created a visitor parking permit.

Permit details:

Permit ID:      {permit_id}
Resident Unit:  {resident_unit}
Visitor:        {visitor_name}
Licence Plate:  {visitor_plate}
Assigned Space: {space_id}
Date:           {date_str}
Time:           {time_str}

This permit was created automatically by SpotOn after validating the resident request and current parking availability.

No action is required unless manual review is needed.

Best,
SpotOn Agent"""

    html = f"""
    <html>
    <body style="font-family: Arial, sans-serif; background: #f8f9fb; padding: 32px;">
      <div style="max-width: 520px; margin: auto; background: white; border-radius: 12px;
                  box-shadow: 0 2px 12px rgba(0,0,0,0.08); overflow: hidden;">

        <div style="background: #0f1f3d; padding: 24px 32px;">
          <h1 style="color: white; margin: 0; font-size: 20px;">🅿️ SpotOn Agent</h1>
          <p style="color: #0e9aad; margin: 4px 0 0; font-size: 13px;">Visitor Parking Notification</p>
        </div>

        <div style="padding: 28px 32px;">
          <p style="color: #333;">Hello,</p>
          <p style="color: #333;">The <strong>SpotOn Agent</strong> has created a visitor parking permit.</p>

          <div style="background: #f0f9fb; border-left: 4px solid #0e9aad; border-radius: 8px;
                      padding: 16px 20px; margin: 20px 0;">
            <p style="margin: 8px 0;">🎫 <strong>Permit ID:</strong> {permit_id}</p>
            <p style="margin: 8px 0;">🏠 <strong>Resident Unit:</strong> {resident_unit}</p>
            <p style="margin: 8px 0;">👤 <strong>Visitor:</strong> {visitor_name}</p>
            <p style="margin: 8px 0;">🚗 <strong>Licence Plate:</strong> {visitor_plate}</p>
            <p style="margin: 8px 0;">🅿️ <strong>Assigned Space:</strong> {space_id}</p>
            <p style="margin: 8px 0;">📅 <strong>Date:</strong> {date_str}</p>
            <p style="margin: 8px 0;">⏰ <strong>Time:</strong> {time_str}</p>
          </div>

          <p style="color: #555; font-size: 13px;">This permit was created automatically by SpotOn after validating the resident request and current parking availability. No action is required unless manual review is needed.</p>
        </div>

        <div style="background: #f0f0f0; padding: 16px 32px; text-align: center;">
          <p style="margin: 0; font-size: 13px; color: #888;">🤖 <strong>SpotOn Agent</strong></p>
        </div>

      </div>
    </body>
    </html>
    """

    return _send_email(recipient_email, "SpotOn Agent — Visitor Parking Notification", plain, html)


def send_release_confirmation_email(
    recipient_email: str,
    permit_id: str,
    space_id: str,
    occupant_label: str,
    occupant_name: str,
    start_time: str,
    end_time: str,
    tz_name: str | None = None,
) -> dict:
    date_str = _format_date(start_time, tz_name)
    time_str = f"{_format_time(start_time, tz_name)} – {_format_time(end_time, tz_name)}"

    plain = f"""SpotOn Agent — Parking Space Released

Hello,

Your SpotOn Agent is reaching out to confirm that your parking permit has been successfully released. ✅

Here are the details:

Permit ID:            {permit_id}
Released Space:       {space_id}
{occupant_label}:      {occupant_name}
Original Booking Date: {date_str}
Original Booking Time: {time_str}

The parking space is now available for other residents or visitors who may need it.

Thank you for releasing the space when it was no longer needed.

This message was automatically generated by the SpotOn Agent as part of the community parking workflow.

Best,
🤖 SpotOn Agent
Park with ease, live in peace."""

    html = f"""
    <html>
    <body style="font-family: Arial, sans-serif; background: #f8f9fb; padding: 32px;">
      <div style="max-width: 520px; margin: auto; background: white; border-radius: 12px;
                  box-shadow: 0 2px 12px rgba(0,0,0,0.08); overflow: hidden;">

        <div style="background: #0f1f3d; padding: 24px 32px;">
          <h1 style="color: white; margin: 0; font-size: 20px;">🅿️ SpotOn Agent</h1>
          <p style="color: #0e9aad; margin: 4px 0 0; font-size: 13px;">Parking Space Released</p>
        </div>

        <div style="padding: 28px 32px;">
          <p style="color: #333;">Hello,</p>
          <p style="color: #333;">Your <strong>SpotOn Agent</strong> is reaching out to confirm that your parking permit has been successfully released. ✅</p>

          <div style="background: #f0f9fb; border-left: 4px solid #0e9aad; border-radius: 8px;
                      padding: 16px 20px; margin: 20px 0;">
            <p style="margin: 8px 0;">🎫 <strong>Permit ID:</strong> {permit_id}</p>
            <p style="margin: 8px 0;">🅿️ <strong>Released Space:</strong> {space_id}</p>
            <p style="margin: 8px 0;">🚗 <strong>{occupant_label}:</strong> {occupant_name}</p>
            <p style="margin: 8px 0;">📅 <strong>Original Booking Date:</strong> {date_str}</p>
            <p style="margin: 8px 0;">⏰ <strong>Original Booking Time:</strong> {time_str}</p>
          </div>

          <p style="color: #333;">The parking space is now available for other residents or visitors who may need it.</p>
          <p style="color: #333;">Thank you for releasing the space when it was no longer needed.</p>
        </div>

        <div style="background: #f0f0f0; padding: 16px 32px; text-align: center;">
          <p style="margin: 0; font-size: 13px; color: #888;">🤖 <strong>SpotOn Agent</strong></p>
          <p style="margin: 4px 0 0; font-size: 12px; color: #aaa;"><em>Park with ease, live in peace.</em></p>
        </div>

      </div>
    </body>
    </html>
    """

    return _send_email(recipient_email, "SpotOn Agent — Parking Space Released ✅", plain, html)


def send_release_admin_notification(
    recipient_email: str,
    permit_id: str,
    permit_type: str,
    space_id: str,
) -> dict:
    plain = f"""SpotOn Agent — Permit Released

Hello,

SpotOn has released the following parking permit:

Permit ID:   {permit_id}
Permit Type: {permit_type}
Space:       {space_id}
Status:      Released

The parking space is now available.

No action is required.

Best,
SpotOn Agent"""

    html = f"""
    <html>
    <body style="font-family: Arial, sans-serif; background: #f8f9fb; padding: 32px;">
      <div style="max-width: 520px; margin: auto; background: white; border-radius: 12px;
                  box-shadow: 0 2px 12px rgba(0,0,0,0.08); overflow: hidden;">

        <div style="background: #0f1f3d; padding: 24px 32px;">
          <h1 style="color: white; margin: 0; font-size: 20px;">🅿️ SpotOn Agent</h1>
          <p style="color: #0e9aad; margin: 4px 0 0; font-size: 13px;">Permit Released</p>
        </div>

        <div style="padding: 28px 32px;">
          <p style="color: #333;">Hello,</p>
          <p style="color: #333;">SpotOn has released the following parking permit:</p>

          <div style="background: #f0f9fb; border-left: 4px solid #0e9aad; border-radius: 8px;
                      padding: 16px 20px; margin: 20px 0;">
            <p style="margin: 8px 0;">🎫 <strong>Permit ID:</strong> {permit_id}</p>
            <p style="margin: 8px 0;">🏷️ <strong>Permit Type:</strong> {permit_type}</p>
            <p style="margin: 8px 0;">🅿️ <strong>Space:</strong> {space_id}</p>
            <p style="margin: 8px 0;">✅ <strong>Status:</strong> Released</p>
          </div>

          <p style="color: #555; font-size: 13px;">The parking space is now available. No action is required.</p>
        </div>

        <div style="background: #f0f0f0; padding: 16px 32px; text-align: center;">
          <p style="margin: 0; font-size: 13px; color: #888;">🤖 <strong>SpotOn Agent</strong></p>
        </div>

      </div>
    </body>
    </html>
    """

    return _send_email(recipient_email, "SpotOn Agent — Permit Released", plain, html)


def send_waitlist_offer_email(
    recipient_email: str,
    space_id: str,
    visitor_name: str,
    visitor_plate: str,
    start_time: str,
    end_time: str,
    tz_name: str | None = None,
) -> dict:
    date_str = _format_date(start_time, tz_name)
    time_str = f"{_format_time(start_time, tz_name)} – {_format_time(end_time, tz_name)}"

    plain = f"""SpotOn Agent — A Parking Space Is Available

Hello,

Your SpotOn Agent found a parking space that matches your waitlisted request. 🎉

Here are the details:

Available Space: {space_id}
Visitor:         {visitor_name}
Licence Plate:   {visitor_plate}
Requested Date:  {date_str}
Requested Time:  {time_str}

A matching space is now available, but your parking permit has not yet been confirmed.

Please return to the SpotOn app and accept the available space to complete your reservation.

Availability is only confirmed once the offer has been accepted in SpotOn.

Best,
🤖 SpotOn Agent
Park with ease, live in peace."""

    html = f"""
    <html>
    <body style="font-family: Arial, sans-serif; background: #f8f9fb; padding: 32px;">
      <div style="max-width: 520px; margin: auto; background: white; border-radius: 12px;
                  box-shadow: 0 2px 12px rgba(0,0,0,0.08); overflow: hidden;">

        <div style="background: #0f1f3d; padding: 24px 32px;">
          <h1 style="color: white; margin: 0; font-size: 20px;">🅿️ SpotOn Agent</h1>
          <p style="color: #0e9aad; margin: 4px 0 0; font-size: 13px;">A Parking Space Is Available</p>
        </div>

        <div style="padding: 28px 32px;">
          <p style="color: #333;">Hello,</p>
          <p style="color: #333;">Your <strong>SpotOn Agent</strong> found a parking space that matches your waitlisted request. 🎉</p>

          <div style="background: #f0f9fb; border-left: 4px solid #0e9aad; border-radius: 8px;
                      padding: 16px 20px; margin: 20px 0;">
            <p style="margin: 8px 0;">🅿️ <strong>Available Space:</strong> {space_id}</p>
            <p style="margin: 8px 0;">👤 <strong>Visitor:</strong> {visitor_name}</p>
            <p style="margin: 8px 0;">🚗 <strong>Licence Plate:</strong> {visitor_plate}</p>
            <p style="margin: 8px 0;">📅 <strong>Requested Date:</strong> {date_str}</p>
            <p style="margin: 8px 0;">⏰ <strong>Requested Time:</strong> {time_str}</p>
          </div>

          <div style="background: #fff8e1; border-radius: 8px; padding: 14px 18px; margin: 20px 0;
                      border-left: 4px solid #f5a623;">
            <p style="margin: 0; color: #555; font-size: 13px;">
              ⚠️ <em>A matching space is now available, but your parking permit has not yet been confirmed.
              Please return to the SpotOn app and accept the available space to complete your reservation.
              Availability is only confirmed once the offer has been accepted in SpotOn.</em>
            </p>
          </div>
        </div>

        <div style="background: #f0f0f0; padding: 16px 32px; text-align: center;">
          <p style="margin: 0; font-size: 13px; color: #888;">🤖 <strong>SpotOn Agent</strong></p>
          <p style="margin: 4px 0 0; font-size: 12px; color: #aaa;"><em>Park with ease, live in peace.</em></p>
        </div>

      </div>
    </body>
    </html>
    """

    return _send_email(recipient_email, "SpotOn Agent — A Parking Space Is Available 🅿️", plain, html)


def send_vehicle_review_notification(
    recipient_email: str,
    space_id: str,
    plate: str,
    reported_at: str,
    reasoning: list,
) -> dict:
    reasoning_text = "\n".join(f"• {line}" for line in reasoning)
    reasoning_html = "".join(f"<li style=\"margin: 4px 0;\">{line}</li>" for line in reasoning)
    reported_display = _format_date(reported_at) + " " + _format_time(reported_at)

    plain = f"""SpotOn Agent — Vehicle Review Notification

Hello,

The SpotOn Agent is forwarding a community parking observation for human review.

Vehicle details:

Space:          {space_id}
Licence Plate:  {plate}
Reported:       {reported_display}

SpotOn reviewed the current community parking records using the available verification tools.

The lookup results were:

{reasoning_text}

The vehicle could not be verified from the currently available SpotOn records.

This message is informational only. SpotOn has not made an enforcement, legal, ticketing, towing, or violation determination.

Please review the situation according to the community's normal human process.

Best,
🤖 SpotOn Agent
Park with ease, live in peace."""

    html = f"""
    <html>
    <body style="font-family: Arial, sans-serif; background: #f8f9fb; padding: 32px;">
      <div style="max-width: 520px; margin: auto; background: white; border-radius: 12px;
                  box-shadow: 0 2px 12px rgba(0,0,0,0.08); overflow: hidden;">

        <div style="background: #0f1f3d; padding: 24px 32px;">
          <h1 style="color: white; margin: 0; font-size: 20px;">🅿️ SpotOn Agent</h1>
          <p style="color: #0a7686; margin: 4px 0 0; font-size: 13px;">Vehicle Review Notification</p>
        </div>

        <div style="padding: 28px 32px;">
          <p style="color: #333;">Hello,</p>
          <p style="color: #333;">The <strong>SpotOn Agent</strong> is forwarding a community parking observation for human review.</p>

          <div style="background: #f0f9fb; border-left: 4px solid #0a7686; border-radius: 8px;
                      padding: 16px 20px; margin: 20px 0;">
            <p style="margin: 8px 0;">🅿️ <strong>Space:</strong> {space_id}</p>
            <p style="margin: 8px 0;">🚗 <strong>Licence Plate:</strong> {plate}</p>
            <p style="margin: 8px 0;">🕒 <strong>Reported:</strong> {reported_display}</p>
          </div>

          <p style="color: #333;">SpotOn reviewed the current community parking records using the available verification tools. The lookup results were:</p>
          <ul style="color: #333;">{reasoning_html}</ul>

          <p style="color: #333;">The vehicle could not be verified from the currently available SpotOn records.</p>

          <div style="background: #fff8e1; border-radius: 8px; padding: 14px 18px; margin: 20px 0;
                      border-left: 4px solid #f5a623;">
            <p style="margin: 0; color: #555; font-size: 13px;">
              ⚠️ <em>This message is informational only. SpotOn has not made an enforcement, legal, ticketing, towing, or violation determination. Please review the situation according to the community's normal human process.</em>
            </p>
          </div>
        </div>

        <div style="background: #f0f0f0; padding: 16px 32px; text-align: center;">
          <p style="margin: 0; font-size: 13px; color: #888;">🤖 <strong>SpotOn Agent</strong></p>
          <p style="margin: 4px 0 0; font-size: 12px; color: #aaa;"><em>Park with ease, live in peace.</em></p>
        </div>

      </div>
    </body>
    </html>
    """

    return _send_email(recipient_email, "SpotOn Agent — Vehicle Review Notification 🚗", plain, html)
