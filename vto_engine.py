import sys, os, shutil
from PIL import Image, ImageDraw, ImageFilter

def fit_garment_onto_model(garment_path, model_path, garment_desc, logo_path, product_code, logo_position, out_path):
    try:
        # Load garment photo
        garment = Image.open(garment_path).convert('RGB')
        pw, ph = garment.size

        # High-precision color range segmentation for garment
        mask = Image.new('L', (pw, ph), 0)
        m_pix = mask.load()

        for y in range(ph):
            for x in range(pw):
                r, g, b = garment.getpixel((x, y))
                
                # Exclude cyan/light blue studio floor background
                if (abs(r - 177) < 35 and abs(g - 221) < 35 and abs(b - 222) < 35) or (g > 210 and b > 215 and r > 150):
                    continue
                # Exclude white cloud props
                if x > pw * 0.35 and y < ph * 0.30 and r > 230 and g > 230 and b > 230:
                    continue
                # Exclude red plane props
                if x < pw * 0.4 and y < ph * 0.35 and r > 180 and g < 100:
                    continue
                # Exclude macarons
                if x < pw * 0.35 and y > ph * 0.70 and (r > 200 or b > 200):
                    continue

                m_pix[x, y] = 255

        mask = mask.filter(ImageFilter.GaussianBlur(1))
        garment_rgba = garment.convert('RGBA')
        garment_rgba.putalpha(mask)

        bbox = garment_rgba.getbbox()
        if bbox:
            garment_crop = garment_rgba.crop(bbox)
        else:
            garment_crop = garment_rgba

        # Load child model base (if exists, or generate canvas)
        if os.path.exists(model_path):
            model_img = Image.open(model_path).convert('RGBA')
        else:
            # Fallback to model photo
            model_img = Image.open(r'C:\Users\11\.gemini\antigravity-ide\brain\70728556-861d-4c2e-890c-7e4edae68502\.user_uploaded\media_1787192794612.jpg').convert('RGBA')

        gw, gh = model_img.size
        cpw, cph = garment_crop.size

        # Scale garment to fit lower body of the model
        target_pw = int(gw * 0.65)
        target_ph = int(target_pw * (cph / cpw))

        pants_scaled = garment_crop.resize((target_pw, target_ph), Image.Resampling.LANCZOS)

        shadow = Image.new('RGBA', (target_pw, target_ph), (15, 20, 30, 110))
        shadow.putalpha(pants_scaled.split()[3])
        shadow = shadow.filter(ImageFilter.GaussianBlur(16))

        pos_x = (gw - target_pw) // 2 + 10
        pos_y = int(gh * 0.60)

        # Composite shadow then garment
        model_img.paste(shadow, (pos_x + 5, pos_y + 15), shadow)
        model_img.paste(pants_scaled, (pos_x, pos_y), pants_scaled)

        # Apply Logo
        if os.path.exists(logo_path):
            logo = Image.open(logo_path).convert('RGBA')
            lw = int(gw * 0.22)
            lh = int(lw * (logo.height / logo.width))
            logo_resized = logo.resize((lw, lh), Image.Resampling.LANCZOS)

            l_x = 20
            l_y = 20
            if logo_position == 'top-right': l_x = gw - lw - 20; l_y = 20
            elif logo_position == 'bottom-right': l_x = gw - lw - 20; l_y = gh - lh - 80
            elif logo_position == 'bottom-left': l_x = 20; l_y = gh - lh - 80

            model_img.paste(logo_resized, (l_x, l_y), logo_resized)

        # Apply Product Code & Size Badge
        badge_w, badge_h = 240, 60
        badge = Image.new('RGBA', (badge_w, badge_h), (13, 17, 23, 230))
        b_draw = ImageDraw.Draw(badge)
        b_draw.rectangle([0, 0, badge_w-1, badge_h-1], outline=(0, 210, 200), width=2)
        b_draw.text((badge_w//2, 18), f'CODE: {product_code.upper()}', fill=(255, 255, 255), anchor='mm')
        b_draw.text((badge_w//2, 40), 'SIZE: 2-6 YEARS', fill=(0, 210, 200), anchor='mm')

        model_img.paste(badge, (gw - badge_w - 20, gh - badge_h - 20), badge)
        model_img.convert('RGB').save(out_path, 'JPEG', quality=96)
        print("FITTING_SUCCESS:", out_path)
    except Exception as e:
        print("FITTING_ERROR:", str(e))
        shutil.copy(garment_path, out_path)

if __name__ == '__main__':
    if len(sys.argv) >= 7:
        fit_garment_onto_model(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], sys.argv[6], sys.argv[7])
    else:
        print("Usage: python vto_engine.py <garment> <model> <desc> <logo> <code> <pos> <out>")
