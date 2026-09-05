# Studio environment asset

The folder contains two 1K CC0 HDR environments from Poly Haven:

- `poly_haven_studio_1k.hdr`, default neutral product-lighting environment, source: https://polyhaven.com/a/poly_haven_studio, MD5 `a1065f613cb6e0388d82a99dcee23d3b`
- `studio_kontrast_02_1k.hdr`, high-contrast comparison environment, source: https://polyhaven.com/a/studio_kontrast_02, MD5 `43dc1c74c406d06a5f3b55735b18e64f`
- License: CC0, https://polyhaven.com/license
- Retrieved: 2026-09-04

The application uses the neutral map for image-based lighting while retaining its own dark visible background. Add `?env=contrast` for the contrast studio or `?env=cards` for the earlier procedural reflection-card environment. `envrot=100` controls HDR rotation in degrees. Add `&ao=0` to remove SSAO and `&shadows=0` to remove shadow maps from a diagnostic comparison.
